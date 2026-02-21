#!/usr/bin/env node

const express = require("express");
const multer = require("multer");
const { spawn, exec } = require("child_process");
const WebSocket = require("ws");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const { Client: SSHClient } = require("ssh2");
const net = require("net");
const Database = require("better-sqlite3");

const app = express();
const server = http.createServer(app);

// ── AUTH ──
const AUTH_USERNAME = "ec2-user";
const AUTH_PASSWORD = "aws";
const authTokens = new Set();

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(";").forEach((pair) => {
    const [key, ...val] = pair.trim().split("=");
    if (key) cookies[key] = decodeURIComponent(val.join("="));
  });
  return cookies;
}

function requireAuth(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["ec2ops-auth"];
  if (token && authTokens.has(token)) {
    return next();
  }
  res.status(401).json({ error: "Unauthorized" });
}

const wss = new WebSocket.Server({
  server,
  verifyClient: (info, done) => {
    const cookies = parseCookies(info.req.headers.cookie);
    const token = cookies["ec2ops-auth"];
    if (token && authTokens.has(token)) {
      done(true);
    } else {
      done(false, 401, "Unauthorized");
    }
  },
});

const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, "uploads");
const LOGS_DIR = path.join(__dirname, "logs");
const DATA_DIR = path.join(__dirname, "data");

// Create directories if they don't exist
[UPLOAD_DIR, LOGS_DIR, DATA_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// ── SQLite DATABASE ──
const db = new Database(path.join(DATA_DIR, "sessions.db"));
db.pragma("journal_mode = WAL");

db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        host         TEXT NOT NULL,
        username     TEXT NOT NULL DEFAULT 'ec2-user',
        mode         TEXT NOT NULL,
        auth_method  TEXT NOT NULL DEFAULT 'pem',
        pem_filename TEXT,
        pem_content  TEXT,
        status       TEXT DEFAULT 'saved',
        timestamp    TEXT NOT NULL DEFAULT (datetime('now')),
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    )
`);
// Add columns if upgrading from older schema
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN pem_content TEXT`);
} catch (_) {}
try {
  db.exec(
    `ALTER TABLE sessions ADD COLUMN health_status TEXT DEFAULT 'unknown'`,
  );
} catch (_) {}
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN last_checked TEXT`);
} catch (_) {}
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN name TEXT DEFAULT ''`);
} catch (_) {}
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN os_detected TEXT DEFAULT ''`);
} catch (_) {}
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN last_connected TEXT`);
} catch (_) {}
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN connection_result TEXT DEFAULT ''`);
} catch (_) {}
db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_host ON sessions(host)`);
db.exec(
  `CREATE INDEX IF NOT EXISTS idx_sessions_ts ON sessions(timestamp DESC)`,
);

// Audit log table
db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        details TEXT,
        host TEXT,
        username TEXT,
        ip_address TEXT,
        timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(timestamp DESC)`);

// Command snippets table
db.exec(`
    CREATE TABLE IF NOT EXISTS command_snippets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        command TEXT NOT NULL,
        category TEXT DEFAULT 'general',
        host TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
`);

// Terminal recordings table
db.exec(`
    CREATE TABLE IF NOT EXISTS terminal_recordings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        host TEXT DEFAULT '',
        data TEXT,
        duration INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
`);

const stmtInsertSnippet = db.prepare(
  `INSERT INTO command_snippets (name, command, category, host) VALUES (@name, @command, @category, @host)`,
);
const stmtGetSnippets = db.prepare(
  `SELECT * FROM command_snippets ORDER BY category, name`,
);
const stmtDeleteSnippet = db.prepare(
  `DELETE FROM command_snippets WHERE id = @id`,
);

const stmtInsertRecording = db.prepare(
  `INSERT INTO terminal_recordings (name, host, data, duration) VALUES (@name, @host, @data, @duration)`,
);
const stmtGetRecordings = db.prepare(
  `SELECT id, name, host, duration, created_at FROM terminal_recordings ORDER BY created_at DESC`,
);
const stmtGetRecording = db.prepare(
  `SELECT * FROM terminal_recordings WHERE id = @id`,
);
const stmtDeleteRecording = db.prepare(
  `DELETE FROM terminal_recordings WHERE id = @id`,
);

const stmtInsertSession = db.prepare(`
    INSERT INTO sessions (host, username, mode, auth_method, pem_filename, pem_content, status, timestamp, name)
    VALUES (@host, @username, @mode, @auth_method, @pem_filename, @pem_content, @status, @timestamp, @name)
`);
const stmtGetAllSessions = db.prepare(`
    SELECT id, host, username, mode, auth_method, pem_filename, name,
           CASE WHEN pem_content IS NOT NULL THEN 1 ELSE 0 END AS has_pem,
           status, timestamp, created_at,
           os_detected, last_connected, connection_result
    FROM sessions ORDER BY timestamp DESC
`);
const stmtFindDuplicate = db.prepare(`
    SELECT id FROM sessions WHERE host = @host AND mode = @mode AND auth_method = @auth_method
`);
const stmtUpsertSession = db.prepare(`
    UPDATE sessions SET name = @name, username = @username, pem_filename = @pem_filename,
           pem_content = @pem_content, status = @status, timestamp = @timestamp
    WHERE id = @id
`);
const stmtGetSessionPem = db.prepare(
  `SELECT pem_content, pem_filename FROM sessions WHERE id = @id`,
);
const stmtDeleteSession = db.prepare(`DELETE FROM sessions WHERE id = @id`);
const stmtDeleteAllSessions = db.prepare(`DELETE FROM sessions`);
const stmtUpdateHealth = db.prepare(
  `UPDATE sessions SET health_status = @status, last_checked = @ts WHERE host = @host`,
);
const stmtGetUniqueHosts = db.prepare(`SELECT DISTINCT host FROM sessions`);
const stmtGetHealthStatuses = db.prepare(`
    SELECT DISTINCT host, health_status, last_checked
    FROM sessions
    ORDER BY host
`);

// Audit log prepared statements
const stmtInsertAudit = db.prepare(`
    INSERT INTO audit_log (action, details, host, username, ip_address, timestamp)
    VALUES (@action, @details, @host, @username, @ip_address, @timestamp)
`);
const stmtGetAuditLog = db.prepare(`
    SELECT * FROM audit_log
    WHERE (@action = '' OR action = @action)
    AND (@search = '' OR details LIKE '%' || @search || '%' OR host LIKE '%' || @search || '%' OR action LIKE '%' || @search || '%')
    ORDER BY timestamp DESC
    LIMIT @limit OFFSET @offset
`);
const stmtCountAuditLog = db.prepare(`
    SELECT COUNT(*) as total FROM audit_log
    WHERE (@action = '' OR action = @action)
    AND (@search = '' OR details LIKE '%' || @search || '%' OR host LIKE '%' || @search || '%' OR action LIKE '%' || @search || '%')
`);
const stmtClearAuditLog = db.prepare(`DELETE FROM audit_log`);

// Configure multer for PEM key uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    // Accept .pem, .key files or any file
    cb(null, true);
  },
  limits: {
    fileSize: 10 * 1024, // 10KB max for key files
  },
});

// Middleware
app.use(express.json({ limit: "3mb" }));
app.use(express.urlencoded({ extended: true }));

// Protect main page — redirect to chooser if authenticated, login if not
app.get(["/", "/index.html"], (req, res, next) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["ec2ops-auth"];
  if (token && authTokens.has(token)) {
    // If ?session= or ?new param present, serve console directly
    if (req.query.session || req.query.new !== undefined) {
      return res.sendFile(path.join(__dirname, "public", "index.html"));
    }
    // Otherwise redirect to chooser
    return res.redirect("/chooser.html");
  }
  res.redirect("/login.html");
});

// Protect chooser page
app.get("/chooser.html", (req, res, next) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["ec2ops-auth"];
  if (token && authTokens.has(token)) {
    return next(); // Let express.static serve it
  }
  res.redirect("/login.html");
});

app.use(express.static("public"));

// Store active WebSocket connections
const clients = new Map();

// Store active SSH terminal sessions (clientId -> { conn, stream })
const terminals = new Map();

// WebSocket connection handler
wss.on("connection", (ws) => {
  const clientId = uuidv4();
  clients.set(clientId, ws);

  console.log(`Client connected: ${clientId}`);

  // Handle incoming messages (terminal input, resize, disconnect)
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    const session = terminals.get(msg.clientId);

    switch (msg.type) {
      case "terminal-input":
        if (session && session.stream) {
          session.stream.write(msg.data);
        }
        break;

      case "terminal-resize":
        if (session && session.stream && msg.cols && msg.rows) {
          try {
            session.stream.setWindow(msg.rows, msg.cols, 0, 0);
          } catch (e) {
            // Ignore resize errors on closed streams
          }
        }
        break;

      case "terminal-disconnect":
        if (session) {
          console.log(`Terminal disconnect requested: ${msg.clientId}`);
          if (session.stream) session.stream.end();
          if (session.conn) session.conn.end();
          terminals.delete(msg.clientId);
        }
        // Clean up docker streams on disconnect
        for (const [key, stream] of dockerLogStreams) {
          if (key.startsWith(msg.clientId + ":")) {
            stream.destroy();
            dockerLogStreams.delete(key);
          }
        }
        if (dockerShellStreams.has(msg.clientId)) {
          const ds = dockerShellStreams.get(msg.clientId);
          if (ds.stream) ds.stream.destroy();
          dockerShellStreams.delete(msg.clientId);
        }
        break;

      case "docker-logs-start": {
        const sess = terminals.get(msg.clientId);
        if (!sess || !sess.conn) break;
        const safeLogId = sanitizePath(msg.containerId);
        const logKey = msg.clientId + ":" + msg.containerId;
        if (dockerLogStreams.has(logKey)) {
          dockerLogStreams.get(logKey).destroy();
          dockerLogStreams.delete(logKey);
        }
        sess.conn.exec(
          `docker logs -f --tail 50 ${safeLogId} 2>&1`,
          (err, logStream) => {
            if (err) return;
            dockerLogStreams.set(logKey, logStream);
            logStream.on("data", (data) => {
              const c = clients.get(msg.clientId);
              if (c && c.readyState === WebSocket.OPEN) {
                c.send(
                  JSON.stringify({
                    type: "docker-log-output",
                    containerId: msg.containerId,
                    data: data.toString("utf-8"),
                  }),
                );
              }
            });
            logStream.on("close", () => {
              dockerLogStreams.delete(logKey);
            });
          },
        );
        break;
      }

      case "docker-logs-stop": {
        const logKey2 = msg.clientId + ":" + msg.containerId;
        if (dockerLogStreams.has(logKey2)) {
          dockerLogStreams.get(logKey2).destroy();
          dockerLogStreams.delete(logKey2);
        }
        break;
      }

      case "docker-shell-start": {
        const sess2 = terminals.get(msg.clientId);
        if (!sess2 || !sess2.conn) break;
        const safeShellId = sanitizePath(msg.containerId);
        if (dockerShellStreams.has(msg.clientId)) {
          const old = dockerShellStreams.get(msg.clientId);
          if (old.stream) old.stream.destroy();
          dockerShellStreams.delete(msg.clientId);
        }
        sess2.conn.exec(
          `docker exec -it ${safeShellId} /bin/sh -c "command -v bash > /dev/null 2>&1 && exec bash || exec sh"`,
          {
            pty: {
              term: "xterm-256color",
              cols: msg.cols || 120,
              rows: msg.rows || 30,
            },
          },
          (err, shellStream) => {
            if (err) {
              const c = clients.get(msg.clientId);
              if (c && c.readyState === WebSocket.OPEN) {
                c.send(
                  JSON.stringify({
                    type: "docker-shell-output",
                    data: "\r\nFailed to attach: " + err.message + "\r\n",
                  }),
                );
              }
              return;
            }
            dockerShellStreams.set(msg.clientId, {
              stream: shellStream,
              containerId: msg.containerId,
            });
            shellStream.on("data", (data) => {
              const c = clients.get(msg.clientId);
              if (c && c.readyState === WebSocket.OPEN) {
                c.send(
                  JSON.stringify({
                    type: "docker-shell-output",
                    data: data.toString("utf-8"),
                  }),
                );
              }
            });
            shellStream.stderr.on("data", (data) => {
              const c = clients.get(msg.clientId);
              if (c && c.readyState === WebSocket.OPEN) {
                c.send(
                  JSON.stringify({
                    type: "docker-shell-output",
                    data: data.toString("utf-8"),
                  }),
                );
              }
            });
            shellStream.on("close", () => {
              dockerShellStreams.delete(msg.clientId);
              const c = clients.get(msg.clientId);
              if (c && c.readyState === WebSocket.OPEN) {
                c.send(JSON.stringify({ type: "docker-shell-exit" }));
              }
            });
          },
        );
        break;
      }

      case "docker-shell-input": {
        const ds = dockerShellStreams.get(msg.clientId);
        if (ds && ds.stream) ds.stream.write(msg.data);
        break;
      }

      case "docker-shell-resize": {
        const ds2 = dockerShellStreams.get(msg.clientId);
        if (ds2 && ds2.stream && msg.cols && msg.rows) {
          try {
            ds2.stream.setWindow(msg.rows, msg.cols, 0, 0);
          } catch (_) {}
        }
        break;
      }

      case "docker-shell-stop": {
        const ds3 = dockerShellStreams.get(msg.clientId);
        if (ds3 && ds3.stream) {
          ds3.stream.destroy();
          dockerShellStreams.delete(msg.clientId);
        }
        break;
      }
      case "cloud-init-start": {
        const sess = terminals.get(msg.clientId);
        if (!sess || !sess.conn) break;
        if (cloudInitStreams.has(msg.clientId)) {
          cloudInitStreams.get(msg.clientId).destroy();
          cloudInitStreams.delete(msg.clientId);
        }
        sess.conn.exec(
          "tail -f /var/log/cloud-init-output.log 2>/dev/null",
          (err, stream) => {
            if (err) return;
            cloudInitStreams.set(msg.clientId, stream);
            stream.on("data", (data) => {
              const c = clients.get(msg.clientId);
              if (c && c.readyState === WebSocket.OPEN) {
                c.send(
                  JSON.stringify({
                    type: "cloud-init-output",
                    data: data.toString("utf-8"),
                  }),
                );
              }
            });
            stream.on("close", () => {
              cloudInitStreams.delete(msg.clientId);
            });
          },
        );
        break;
      }
      case "cloud-init-stop": {
        if (cloudInitStreams.has(msg.clientId)) {
          cloudInitStreams.get(msg.clientId).destroy();
          cloudInitStreams.delete(msg.clientId);
        }
        break;
      }
    }
  });

  ws.on("close", () => {
    // Kill any active terminal session for this client
    const session = terminals.get(clientId);
    if (session) {
      console.log(`Cleaning up terminal for disconnected client: ${clientId}`);
      if (session.stream) session.stream.end();
      if (session.conn) session.conn.end();
      terminals.delete(clientId);
    }

    // Clean up docker streams
    for (const [key, stream] of dockerLogStreams) {
      if (key.startsWith(clientId + ":")) {
        stream.destroy();
        dockerLogStreams.delete(key);
      }
    }
    if (dockerShellStreams.has(clientId)) {
      const ds = dockerShellStreams.get(clientId);
      if (ds.stream) ds.stream.destroy();
      dockerShellStreams.delete(clientId);
    }

    clients.delete(clientId);
    distroCache.delete(clientId);
    if (cloudInitStreams.has(clientId)) {
      try {
        cloudInitStreams.get(clientId).destroy();
      } catch (_) {}
      cloudInitStreams.delete(clientId);
    }
    console.log(`Client disconnected: ${clientId}`);
  });

  // Send client ID
  ws.send(
    JSON.stringify({
      type: "connected",
      clientId: clientId,
      timestamp: new Date().toISOString(),
    }),
  );
});

// Broadcast log to specific client
function sendLog(clientId, data) {
  const client = clients.get(clientId);
  if (client && client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(data));
  }
}

// Broadcast to all connected clients
function broadcast(data) {
  const msg = typeof data === "string" ? data : JSON.stringify(data);
  for (const [, ws] of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

// Execute a one-shot command on an active SSH session
function execOnTerminal(clientId, command) {
  return new Promise((resolve, reject) => {
    const session = terminals.get(clientId);
    if (!session || !session.conn)
      return reject(new Error("No active SSH session"));
    session.conn.exec(command, (err, stream) => {
      if (err) return reject(err);
      let stdout = "",
        stderr = "";
      stream.on("data", (d) => {
        stdout += d.toString();
      });
      stream.stderr.on("data", (d) => {
        stderr += d.toString();
      });
      stream.on("close", (code) => {
        if (code !== 0 && !stdout)
          return reject(new Error(stderr || `Exit code ${code}`));
        resolve(stdout);
      });
    });
  });
}

// Sanitize paths for shell command interpolation
function sanitizePath(p) {
  return p.replace(/[;|&`$(){}!\n\r]/g, "");
}

// ── DISTRO DETECTION ──
const distroCache = new Map();

async function detectDistro(clientId) {
  if (distroCache.has(clientId)) return distroCache.get(clientId);
  const output = await execOnTerminal(
    clientId,
    'cat /etc/os-release 2>/dev/null | grep "^ID=" | cut -d= -f2 | tr -d \'"\'',
  );
  const id = output.trim().toLowerCase();
  let pkgManager = "unknown";
  if (["ubuntu", "debian"].includes(id)) pkgManager = "apt";
  else if (
    ["amzn", "centos", "rhel", "fedora", "ol", "rocky", "almalinux"].includes(
      id,
    )
  ) {
    try {
      await execOnTerminal(clientId, "command -v dnf");
      pkgManager = "dnf";
    } catch (_) {
      pkgManager = "yum";
    }
  }
  const result = { id, pkgManager };
  distroCache.set(clientId, result);
  return result;
}

// Batch jobs storage
const batchJobs = new Map();

// Cloud-init tail streams
const cloudInitStreams = new Map();

// Temporary SSH key pairs
const tempKeyPairs = new Map();

// ── TIMEZONE WHITELIST ──
const VALID_TIMEZONES = [
  "UTC",
  "US/Eastern",
  "US/Central",
  "US/Mountain",
  "US/Pacific",
  "US/Alaska",
  "US/Hawaii",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Vancouver",
  "America/Sao_Paulo",
  "America/Argentina/Buenos_Aires",
  "America/Mexico_City",
  "America/Bogota",
  "America/Lima",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Amsterdam",
  "Europe/Brussels",
  "Europe/Zurich",
  "Europe/Stockholm",
  "Europe/Moscow",
  "Europe/Istanbul",
  "Europe/Warsaw",
  "Europe/Athens",
  "Asia/Kolkata",
  "Asia/Mumbai",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Singapore",
  "Asia/Seoul",
  "Asia/Dubai",
  "Asia/Bangkok",
  "Asia/Jakarta",
  "Asia/Taipei",
  "Asia/Karachi",
  "Asia/Dhaka",
  "Asia/Riyadh",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Perth",
  "Australia/Brisbane",
  "Pacific/Auckland",
  "Pacific/Fiji",
  "Africa/Cairo",
  "Africa/Lagos",
  "Africa/Johannesburg",
  "Africa/Nairobi",
];

// API Routes
app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;
  if (username === AUTH_USERNAME && password === AUTH_PASSWORD) {
    const token = uuidv4();
    authTokens.add(token);
    res.cookie("ec2ops-auth", token, {
      httpOnly: true,
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    logAudit("login", `User ${username} logged in`, "", req);
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, error: "Invalid credentials" });
  }
});

app.post("/api/auth/logout", (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["ec2ops-auth"];
  if (token) authTokens.delete(token);
  res.clearCookie("ec2ops-auth");
  logAudit("logout", "User logged out", "", req);
  res.json({ success: true });
});

app.get("/api/auth/check", (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["ec2ops-auth"];
  res.json({ authenticated: !!(token && authTokens.has(token)) });
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Upload PEM key
app.post(
  "/api/upload-key",
  requireAuth,
  upload.single("pemKey"),
  (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // Set proper permissions (400)
    fs.chmodSync(req.file.path, 0o400);

    res.json({
      success: true,
      filename: req.file.filename,
      path: req.file.path,
      size: req.file.size,
    });
  },
);

// Execute password setup script
app.post("/api/setup-password", requireAuth, async (req, res) => {
  const { password, username, pemKeyPath, ec2Host, clientId, useUserData } =
    req.body;

  // Validation
  if (!password) {
    return res.status(400).json({ error: "Password is required" });
  }

  if (useUserData === "true" || useUserData === true) {
    // Generate user-data script
    return handleUserDataGeneration(req, res);
  }

  if (!ec2Host) {
    return res.status(400).json({ error: "EC2 Host is required" });
  }

  if (!pemKeyPath) {
    return res.status(400).json({ error: "PEM key is required" });
  }

  const executionId = uuidv4();
  const logFile = path.join(LOGS_DIR, `${executionId}.log`);

  // Prepare command
  const scriptPath = path.join(__dirname, "create-password.sh");
  const args = [password];

  if (username) args.push(username);
  if (pemKeyPath) args.push(pemKeyPath);

  // Set environment variable for EC2 host
  const env = {
    ...process.env,
    EC2_HOST: ec2Host,
  };

  sendLog(clientId, {
    type: "log",
    level: "info",
    message: `Starting EC2 password setup...`,
    timestamp: new Date().toISOString(),
  });

  sendLog(clientId, {
    type: "log",
    level: "info",
    message: `Configuration:`,
    timestamp: new Date().toISOString(),
  });

  sendLog(clientId, {
    type: "log",
    level: "info",
    message: `  - EC2 Host: ${ec2Host}`,
    timestamp: new Date().toISOString(),
  });

  sendLog(clientId, {
    type: "log",
    level: "info",
    message: `  - Username: ${username || "ec2-user"}`,
    timestamp: new Date().toISOString(),
  });

  sendLog(clientId, {
    type: "log",
    level: "info",
    message: `  - PEM Key: ${path.basename(pemKeyPath)}`,
    timestamp: new Date().toISOString(),
  });

  sendLog(clientId, {
    type: "log",
    level: "info",
    message: `\nExecuting script...\n`,
    timestamp: new Date().toISOString(),
  });

  // Execute script
  const child = spawn(scriptPath, args, {
    env: env,
    cwd: __dirname,
  });

  let logStream = fs.createWriteStream(logFile);

  child.stdout.on("data", (data) => {
    const message = data.toString();
    logStream.write(message);

    sendLog(clientId, {
      type: "log",
      level: "info",
      message: message,
      timestamp: new Date().toISOString(),
    });
  });

  child.stderr.on("data", (data) => {
    const message = data.toString();
    logStream.write(`ERROR: ${message}`);

    sendLog(clientId, {
      type: "log",
      level: "error",
      message: message,
      timestamp: new Date().toISOString(),
    });
  });

  child.on("close", (code) => {
    logStream.end();

    const success = code === 0;

    sendLog(clientId, {
      type: "complete",
      success: success,
      exitCode: code,
      message: success
        ? "Setup completed successfully!"
        : `Setup failed with exit code ${code}`,
      timestamp: new Date().toISOString(),
      executionId: executionId,
    });

    // Clean up uploaded PEM key after execution
    if (pemKeyPath && pemKeyPath.startsWith(UPLOAD_DIR)) {
      setTimeout(() => {
        fs.unlink(pemKeyPath, (err) => {
          if (err) console.error("Error deleting PEM key:", err);
        });
      }, 5000); // Delete after 5 seconds
    }
  });

  res.json({
    success: true,
    executionId: executionId,
    message: "Setup script started",
  });
});

// Generate user-data script
function handleUserDataGeneration(req, res) {
  const { password } = req.body;
  const executionId = uuidv4();

  // Read user-data template
  const templatePath = path.join(__dirname, "user-data.sh");
  let userDataScript = fs.readFileSync(templatePath, "utf8");

  // Replace password
  userDataScript = userDataScript.replace(
    /ROOT_PASSWORD="\${ROOT_PASSWORD:-.*?}"/,
    `ROOT_PASSWORD="${password}"`,
  );

  // Save customized script
  const outputPath = path.join(LOGS_DIR, `user-data-${executionId}.sh`);
  fs.writeFileSync(outputPath, userDataScript);

  res.json({
    success: true,
    executionId: executionId,
    message: "User data script generated",
    downloadUrl: `/api/download/${path.basename(outputPath)}`,
  });
}

// Download generated files
app.get("/api/download/:filename", requireAuth, (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(LOGS_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  res.download(filePath, filename);
});

// Get execution log
app.get("/api/logs/:executionId", requireAuth, (req, res) => {
  const { executionId } = req.params;
  const logFile = path.join(LOGS_DIR, `${executionId}.log`);

  if (!fs.existsSync(logFile)) {
    return res.status(404).json({ error: "Log file not found" });
  }

  const logContent = fs.readFileSync(logFile, "utf8");
  res.json({
    executionId: executionId,
    content: logContent,
  });
});

// List all executions
app.get("/api/executions", requireAuth, (req, res) => {
  const logFiles = fs
    .readdirSync(LOGS_DIR)
    .filter((f) => f.endsWith(".log"))
    .map((f) => {
      const stats = fs.statSync(path.join(LOGS_DIR, f));
      return {
        executionId: f.replace(".log", ""),
        filename: f,
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
      };
    })
    .sort((a, b) => b.created - a.created);

  res.json(logFiles);
});

// ── SESSION STORAGE ROUTES ──

// Get all saved sessions (grouped by host)
app.get("/api/sessions", requireAuth, (req, res) => {
  try {
    const sessions = stmtGetAllSessions.all();
    const grouped = {};
    for (const s of sessions) {
      if (!grouped[s.host]) grouped[s.host] = [];
      grouped[s.host].push(s);
    }
    res.json({ sessions, grouped });
  } catch (err) {
    console.error("Error fetching sessions:", err);
    res.status(500).json({ error: "Failed to fetch sessions" });
  }
});

// Save a session
app.post("/api/sessions", requireAuth, (req, res) => {
  try {
    const {
      host,
      username,
      mode,
      auth_method,
      pem_filename,
      pem_content,
      status,
      name,
    } = req.body;
    if (!host) return res.status(400).json({ error: "Host is required" });
    if (!mode) return res.status(400).json({ error: "Mode is required" });

    const hostTrimmed = host.trim();
    const sessionName = name || `${username || "ec2-user"}@${hostTrimmed}`;

    // Check for existing session with same host+mode+auth_method (upsert)
    const existing = stmtFindDuplicate.get({
      host: hostTrimmed,
      mode,
      auth_method: auth_method || "pem",
    });

    let sessionId;
    if (existing) {
      // Update existing session
      stmtUpsertSession.run({
        id: existing.id,
        name: sessionName,
        username: username || "ec2-user",
        pem_filename: pem_filename || null,
        pem_content: pem_content || null,
        status: status || "saved",
        timestamp: new Date().toISOString(),
      });
      sessionId = existing.id;
    } else {
      // Check max 5 distinct hosts
      const hosts = stmtGetUniqueHosts.all();
      const uniqueHosts = new Set(hosts.map((h) => h.host));
      if (!uniqueHosts.has(hostTrimmed) && uniqueHosts.size >= 5) {
        return res
          .status(400)
          .json({ error: "Maximum 5 hosts reached. Delete a session first." });
      }

      const result = stmtInsertSession.run({
        host: hostTrimmed,
        username: username || "ec2-user",
        mode,
        auth_method: auth_method || "pem",
        pem_filename: pem_filename || null,
        pem_content: pem_content || null,
        status: status || "saved",
        timestamp: new Date().toISOString(),
        name: sessionName,
      });
      sessionId = Number(result.lastInsertRowid);
    }

    logAudit("session_save", `Session saved: ${sessionName}`, hostTrimmed, req);
    res.json({ success: true, id: sessionId });
  } catch (err) {
    console.error("Error saving session:", err);
    res.status(500).json({ error: "Failed to save session" });
  }
});

// Delete a session (or all with id=all)
app.delete("/api/sessions/:id", requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    if (id === "all") {
      const result = stmtDeleteAllSessions.run();
      return res.json({ success: true, deleted: result.changes });
    }
    const numId = parseInt(id, 10);
    if (isNaN(numId))
      return res.status(400).json({ error: "Invalid session ID" });

    const result = stmtDeleteSession.run({ id: numId });
    if (result.changes === 0)
      return res.status(404).json({ error: "Session not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting session:", err);
    res.status(500).json({ error: "Failed to delete session" });
  }
});

// Restore PEM key from saved session — writes to temp file and returns path
app.get("/api/sessions/:id/pem", requireAuth, (req, res) => {
  try {
    const numId = parseInt(req.params.id, 10);
    if (isNaN(numId))
      return res.status(400).json({ error: "Invalid session ID" });

    const row = stmtGetSessionPem.get({ id: numId });
    if (!row || !row.pem_content) {
      return res
        .status(404)
        .json({ error: "No PEM key saved for this session" });
    }

    // Write PEM content to a temp file in uploads
    const tempName = `${uuidv4()}-restored.pem`;
    const tempPath = path.join(UPLOAD_DIR, tempName);
    fs.writeFileSync(tempPath, row.pem_content, "utf8");
    fs.chmodSync(tempPath, 0o400);

    res.json({
      success: true,
      path: tempPath,
      filename: row.pem_filename || "restored.pem",
    });
  } catch (err) {
    console.error("Error restoring PEM:", err);
    res.status(500).json({ error: "Failed to restore PEM key" });
  }
});

// ── HEALTH CHECK INFRASTRUCTURE ──

// TCP port 22 reachability check
function checkHostHealth(host) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: 22, timeout: 5000 });
    socket.on("connect", () => {
      socket.destroy();
      resolve("online");
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve("offline");
    });
    socket.on("error", () => {
      socket.destroy();
      resolve("offline");
    });
  });
}

// Run health checks for all unique hosts
async function runHealthChecks() {
  try {
    const hosts = stmtGetUniqueHosts.all();
    if (hosts.length === 0) return;

    const now = new Date().toISOString();

    for (const { host } of hosts) {
      const status = await checkHostHealth(host);
      stmtUpdateHealth.run({ host, status, ts: now });

      broadcast({
        type: "health-update",
        host,
        status,
        lastChecked: now,
      });
    }
  } catch (err) {
    console.error("Health check error:", err);
  }
}

// Run health checks every 60 seconds
const healthCheckInterval = setInterval(runHealthChecks, 60000);

// Initial health check after 5 seconds
setTimeout(runHealthChecks, 5000);

// Get health statuses for all hosts
app.get("/api/health-status", requireAuth, (req, res) => {
  try {
    const rows = stmtGetHealthStatuses.all();
    const statuses = {};
    for (const row of rows) {
      statuses[row.host] = {
        status: row.health_status || "unknown",
        lastChecked: row.last_checked || null,
      };
    }
    res.json({ statuses });
  } catch (err) {
    console.error("Error fetching health statuses:", err);
    res.status(500).json({ error: "Failed to fetch health statuses" });
  }
});

// Trigger immediate health check
app.post("/api/health-check", requireAuth, async (req, res) => {
  try {
    await runHealthChecks();
    const rows = stmtGetHealthStatuses.all();
    const statuses = {};
    for (const row of rows) {
      statuses[row.host] = {
        status: row.health_status || "unknown",
        lastChecked: row.last_checked || null,
      };
    }
    res.json({ success: true, statuses });
  } catch (err) {
    console.error("Health check failed:", err);
    res.status(500).json({ error: "Health check failed" });
  }
});

// ── RESOURCE GATHERING ──

// Helper: log an audit entry
function logAudit(action, details, host, req) {
  const ip = req
    ? req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown"
    : "system";
  const entry = {
    action,
    details: details || "",
    host: host || "",
    username: "",
    ip_address: ip,
    timestamp: new Date().toISOString(),
  };
  try {
    const result = stmtInsertAudit.run(entry);
    entry.id = Number(result.lastInsertRowid);
    broadcast({ type: "audit-entry", entry });
  } catch (err) {
    console.error("Audit log error:", err);
  }
}

// ── AUDIT LOG ROUTES ──

app.get("/api/audit-log", requireAuth, (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = (page - 1) * limit;
    const action = req.query.action || "";
    const search = req.query.search || "";

    const rows = stmtGetAuditLog.all({ action, search, limit, offset });
    const countRow = stmtCountAuditLog.get({ action, search });
    const total = countRow ? countRow.total : 0;

    res.json({
      entries: rows,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("Error fetching audit log:", err);
    res.status(500).json({ error: "Failed to fetch audit log" });
  }
});

app.delete("/api/audit-log", requireAuth, (req, res) => {
  try {
    stmtClearAuditLog.run();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to clear audit log" });
  }
});

app.get("/api/audit-log/export", requireAuth, (req, res) => {
  try {
    const rows = db
      .prepare("SELECT * FROM audit_log ORDER BY timestamp DESC")
      .all();
    let csv = "id,action,details,host,username,ip_address,timestamp\n";
    for (const r of rows) {
      csv += `${r.id},"${(r.action || "").replace(/"/g, '""')}","${(r.details || "").replace(/"/g, '""')}","${(r.host || "").replace(/"/g, '""')}","${(r.username || "").replace(/"/g, '""')}","${(r.ip_address || "").replace(/"/g, '""')}","${r.timestamp}"\n`;
    }
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=audit-log.csv");
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: "Failed to export audit log" });
  }
});

// ── COMMAND SNIPPETS ROUTES ──

app.get("/api/snippets", requireAuth, (req, res) => {
  try {
    const snippets = stmtGetSnippets.all();
    res.json({ success: true, snippets });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch snippets" });
  }
});

app.post("/api/snippets", requireAuth, (req, res) => {
  try {
    const { name, command, category, host } = req.body;
    if (!name || !command)
      return res.status(400).json({ error: "Name and command required" });
    const result = stmtInsertSnippet.run({
      name,
      command,
      category: category || "general",
      host: host || "",
    });
    logAudit("snippet_add", `Added snippet: ${name}`, "", req);
    res.json({ success: true, id: Number(result.lastInsertRowid) });
  } catch (err) {
    res.status(500).json({ error: "Failed to save snippet" });
  }
});

app.delete("/api/snippets/:id", requireAuth, (req, res) => {
  try {
    stmtDeleteSnippet.run({ id: parseInt(req.params.id) });
    logAudit("snippet_delete", `Deleted snippet #${req.params.id}`, "", req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete snippet" });
  }
});

// ── TERMINAL RECORDINGS ROUTES ──

app.get("/api/recordings", requireAuth, (req, res) => {
  try {
    const recordings = stmtGetRecordings.all();
    res.json({ success: true, recordings });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch recordings" });
  }
});

app.get("/api/recordings/:id", requireAuth, (req, res) => {
  try {
    const recording = stmtGetRecording.get({ id: parseInt(req.params.id) });
    if (!recording)
      return res.status(404).json({ error: "Recording not found" });
    res.json({ success: true, recording });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch recording" });
  }
});

app.post("/api/recordings", requireAuth, (req, res) => {
  try {
    const { name, host, data, duration } = req.body;
    if (!name || !data)
      return res.status(400).json({ error: "Name and data required" });
    const result = stmtInsertRecording.run({
      name,
      host: host || "",
      data,
      duration: duration || 0,
    });
    logAudit("recording_save", `Saved recording: ${name}`, host || "", req);
    res.json({ success: true, id: Number(result.lastInsertRowid) });
  } catch (err) {
    res.status(500).json({ error: "Failed to save recording" });
  }
});

app.delete("/api/recordings/:id", requireAuth, (req, res) => {
  try {
    stmtDeleteRecording.run({ id: parseInt(req.params.id) });
    logAudit(
      "recording_delete",
      `Deleted recording #${req.params.id}`,
      "",
      req,
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete recording" });
  }
});

// ── PROCESS MANAGER ROUTES ──

function parseProcessOutput(output) {
  const lines = output.trim().split("\n");
  if (lines.length < 2) return [];
  const processes = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].trim().split(/\s+/);
    if (parts.length < 11) continue;
    processes.push({
      user: parts[0],
      pid: parseInt(parts[1]),
      cpu: parseFloat(parts[2]),
      mem: parseFloat(parts[3]),
      vsz: parseInt(parts[4]),
      rss: parseInt(parts[5]),
      stat: parts[7],
      command: parts.slice(10).join(" "),
    });
  }
  return processes;
}

app.post("/api/processes", requireAuth, async (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  try {
    const output = await execOnTerminal(
      clientId,
      "ps aux --sort=-%cpu | head -51",
    );
    const processes = parseProcessOutput(output);
    res.json({ success: true, processes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/processes/kill", requireAuth, async (req, res) => {
  const { clientId, pid } = req.body;
  if (!clientId || !pid)
    return res.status(400).json({ error: "clientId and pid required" });
  try {
    await execOnTerminal(clientId, `kill -15 ${parseInt(pid)}`);
    logAudit("process_kill", `Killed PID ${pid}`, "", req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PORT & SERVICE STATUS ROUTES ──

const COMMON_PORT_LABELS = {
  22: "SSH",
  80: "HTTP",
  443: "HTTPS",
  3306: "MySQL",
  5432: "PostgreSQL",
  6379: "Redis",
  27017: "MongoDB",
  8080: "App",
  8443: "HTTPS-Alt",
  3000: "Dev",
  5000: "Flask",
  8000: "Alt-HTTP",
  9090: "Prometheus",
  2379: "etcd",
  6443: "K8s-API",
  25: "SMTP",
  53: "DNS",
  111: "RPC",
  993: "IMAPS",
  995: "POP3S",
  1433: "MSSQL",
  11211: "Memcached",
};

function parsePortsOutput(output) {
  const lines = output.trim().split("\n");
  const ports = [];
  for (const line of lines) {
    if (
      line.startsWith("State") ||
      line.startsWith("Netid") ||
      line.startsWith("Proto") ||
      !line.trim()
    )
      continue;
    // ss format: State Recv-Q Send-Q Local_Address:Port Peer_Address:Port Process
    // netstat format: Proto Recv-Q Send-Q Local_Address Foreign_Address State PID/Program
    const parts = line.trim().split(/\s+/);
    let port = 0,
      address = "",
      program = "",
      state = "";
    if (parts[0] === "tcp" || parts[0] === "tcp6" || parts[0] === "udp") {
      // netstat format
      const addrParts = (parts[3] || "").split(":");
      port = parseInt(addrParts[addrParts.length - 1]) || 0;
      address = addrParts.slice(0, -1).join(":") || "*";
      state = parts[5] || "LISTEN";
      program = parts[6] || "";
    } else if (parts[0] === "LISTEN" || parts[0] === "ESTAB") {
      // ss format
      const addrParts = (parts[3] || "").split(":");
      port = parseInt(addrParts[addrParts.length - 1]) || 0;
      address = addrParts.slice(0, -1).join(":") || "*";
      state = parts[0];
      program = parts.slice(5).join(" ") || "";
    }
    if (port > 0) {
      ports.push({
        port,
        address,
        program,
        state,
        protocol: "tcp",
        label: COMMON_PORT_LABELS[port] || "",
      });
    }
  }
  // Deduplicate by port
  const seen = new Set();
  return ports
    .filter((p) => {
      if (seen.has(p.port)) return false;
      seen.add(p.port);
      return true;
    })
    .sort((a, b) => a.port - b.port);
}

function parseServicesOutput(output) {
  const lines = output.trim().split("\n");
  const services = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    // systemctl format: unit.service loaded active running Description here
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const name = parts[0].replace(".service", "");
    const status =
      parts[2] === "active"
        ? "running"
        : parts[2] === "failed"
          ? "failed"
          : parts[2];
    const description = parts.slice(4).join(" ");
    services.push({ name, status, description });
  }
  return services;
}

app.post("/api/services", requireAuth, async (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  try {
    const [portsOut, servicesOut] = await Promise.all([
      execOnTerminal(
        clientId,
        "ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null",
      ).catch(() => ""),
      execOnTerminal(
        clientId,
        "systemctl list-units --type=service --state=running,failed --no-pager --no-legend 2>/dev/null",
      ).catch(() => ""),
    ]);
    const ports = parsePortsOutput(portsOut);
    const services = parseServicesOutput(servicesOut);
    res.json({ success: true, ports, services });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── NETWORK MONITORING ROUTES ──

function parseNetworkConnections(output) {
  const lines = output.trim().split("\n");
  const connections = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 5) continue;
    const proto = parts[0];
    const state = parts.length >= 6 ? parts[1] : "";
    const localIdx = parts.length >= 6 ? 4 : 3;
    const remoteIdx = localIdx + 1;
    const local = parts[localIdx] || "";
    const remote = parts[remoteIdx] || "";
    const processInfo = parts.slice(remoteIdx + 1).join(" ");
    const localParts = local.split(":");
    const remoteParts = remote.split(":");
    connections.push({
      proto,
      state: state || "ESTABLISHED",
      localAddr: localParts.slice(0, -1).join(":") || "*",
      localPort: localParts[localParts.length - 1] || "*",
      remoteAddr: remoteParts.slice(0, -1).join(":") || "*",
      remotePort: remoteParts[remoteParts.length - 1] || "*",
      process: processInfo.replace(/users:\(\("?|"?\)\)/g, "").trim(),
    });
  }
  return connections;
}

function parseNetworkInterfaces(output) {
  const lines = output.trim().split("\n");
  const interfaces = [];
  for (let i = 2; i < lines.length; i++) {
    const parts = lines[i].trim().split(/[\s|:]+/);
    if (parts.length < 10) continue;
    interfaces.push({
      name: parts[0],
      rxBytes: parseInt(parts[1]) || 0,
      rxPackets: parseInt(parts[2]) || 0,
      txBytes: parseInt(parts[9]) || 0,
      txPackets: parseInt(parts[10]) || 0,
    });
  }
  return interfaces;
}

app.post("/api/network", requireAuth, async (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  try {
    const [connectionsOut, interfacesOut] = await Promise.all([
      execOnTerminal(
        clientId,
        "ss -tupn 2>/dev/null || netstat -tupn 2>/dev/null",
      ).catch(() => ""),
      execOnTerminal(clientId, "cat /proc/net/dev 2>/dev/null").catch(() => ""),
    ]);
    const connections = parseNetworkConnections(connectionsOut);
    const interfaces = parseNetworkInterfaces(interfacesOut);
    res.json({ success: true, connections, interfaces });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── USER MANAGEMENT ROUTES ──

function parsePasswd(passwdOut, sudoOut, wheelOut) {
  const sudoUsers = new Set();
  // Parse sudo group members
  for (const line of [sudoOut, wheelOut]) {
    if (!line) continue;
    const parts = line.trim().split(":");
    if (parts.length >= 4) {
      parts[3]
        .split(",")
        .filter(Boolean)
        .forEach((u) => sudoUsers.add(u));
    }
  }
  // root is always sudo
  sudoUsers.add("root");

  const users = [];
  const lines = passwdOut.trim().split("\n");
  for (const line of lines) {
    const parts = line.split(":");
    if (parts.length < 7) continue;
    const uid = parseInt(parts[2]);
    // Show root and regular users (uid >= 1000)
    if (uid !== 0 && uid < 1000) continue;
    users.push({
      username: parts[0],
      uid,
      gid: parseInt(parts[3]),
      home: parts[5],
      shell: parts[6],
      isSudo: sudoUsers.has(parts[0]),
    });
  }
  return users;
}

// ── DOCKER PARSER FUNCTIONS ──

function parseDockerContainers(output) {
  if (!output || !output.trim()) return [];
  const lines = output.trim().split("\n");
  const containers = [];
  for (const line of lines) {
    const parts = line.split("|");
    if (parts.length < 6) continue;
    containers.push({
      id: parts[0],
      name: parts[1],
      image: parts[2],
      status: parts[3],
      ports: parts[4] || "",
      state: parts[5].toLowerCase(),
      createdAt: parts[6] || "",
      size: parts[7] || "",
    });
  }
  return containers;
}

function parseDockerStats(output) {
  if (!output || !output.trim()) return [];
  const lines = output.trim().split("\n");
  const stats = [];
  for (const line of lines) {
    const parts = line.split("|");
    if (parts.length < 8) continue;
    stats.push({
      containerId: parts[0],
      name: parts[1],
      cpuPercent: parseFloat(parts[2]) || 0,
      memUsage: parts[3] || "",
      memPercent: parseFloat(parts[4]) || 0,
      netIO: parts[5] || "",
      blockIO: parts[6] || "",
      pids: parseInt(parts[7]) || 0,
    });
  }
  return stats;
}

function parseDockerImages(output) {
  if (!output || !output.trim()) return [];
  const lines = output.trim().split("\n");
  const images = [];
  for (const line of lines) {
    const parts = line.split("|");
    if (parts.length < 5) continue;
    images.push({
      repository: parts[0],
      tag: parts[1],
      id: parts[2],
      createdSince: parts[3],
      size: parts[4],
    });
  }
  return images;
}

function parseDockerCompose(output) {
  if (!output || !output.trim()) return [];
  const lines = output.trim().split("\n");
  const services = [];
  for (const line of lines) {
    const parts = line.split("|");
    if (parts.length < 3) continue;
    services.push({
      name: parts[0],
      service: parts[1],
      status: parts[2],
      ports: parts[3] || "",
      state: (parts[4] || "").toLowerCase(),
    });
  }
  return services;
}

function parseDockerVolumes(output) {
  if (!output || !output.trim()) return [];
  const lines = output.trim().split("\n");
  const volumes = [];
  for (const line of lines) {
    const parts = line.split("|");
    if (parts.length < 3) continue;
    volumes.push({
      name: parts[0],
      driver: parts[1],
      scope: parts[2],
      mountpoint: parts[3] || "",
    });
  }
  return volumes;
}

function parseDockerNetworks(output) {
  if (!output || !output.trim()) return [];
  const lines = output.trim().split("\n");
  const networks = [];
  for (const line of lines) {
    const parts = line.split("|");
    if (parts.length < 4) continue;
    networks.push({
      id: parts[0],
      name: parts[1],
      driver: parts[2],
      scope: parts[3],
    });
  }
  return networks;
}

function parseDockerInspect(output) {
  try {
    const data = JSON.parse(output.trim());
    const c = Array.isArray(data) ? data[0] : data;
    return {
      id: c.Id,
      name: (c.Name || "").replace(/^\//, ""),
      image: c.Config && c.Config.Image,
      created: c.Created,
      state: {
        status: c.State && c.State.Status,
        startedAt: c.State && c.State.StartedAt,
        finishedAt: c.State && c.State.FinishedAt,
        exitCode: c.State && c.State.ExitCode,
        pid: c.State && c.State.Pid,
      },
      config: {
        env: (c.Config && c.Config.Env) || [],
        cmd: (c.Config && c.Config.Cmd) || [],
        entrypoint: (c.Config && c.Config.Entrypoint) || [],
        workingDir: c.Config && c.Config.WorkingDir,
        hostname: c.Config && c.Config.Hostname,
      },
      hostConfig: {
        memory: c.HostConfig && c.HostConfig.Memory,
        cpuShares: c.HostConfig && c.HostConfig.CpuShares,
        restartPolicy: c.HostConfig && c.HostConfig.RestartPolicy,
        binds: (c.HostConfig && c.HostConfig.Binds) || [],
        portBindings: (c.HostConfig && c.HostConfig.PortBindings) || {},
      },
      networkSettings: {
        networks: (c.NetworkSettings && c.NetworkSettings.Networks) || {},
        ports: (c.NetworkSettings && c.NetworkSettings.Ports) || {},
      },
      mounts: (c.Mounts || []).map((m) => ({
        type: m.Type,
        source: m.Source,
        destination: m.Destination,
        mode: m.Mode,
        rw: m.RW,
      })),
    };
  } catch (e) {
    return null;
  }
}

app.post("/api/users", requireAuth, async (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  try {
    const [passwdOut, sudoOut, wheelOut] = await Promise.all([
      execOnTerminal(clientId, "cat /etc/passwd").catch(() => ""),
      execOnTerminal(clientId, "getent group sudo 2>/dev/null").catch(() => ""),
      execOnTerminal(clientId, "getent group wheel 2>/dev/null").catch(
        () => "",
      ),
    ]);
    const users = parsePasswd(passwdOut, sudoOut, wheelOut);
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/users/add", requireAuth, async (req, res) => {
  const { clientId, username, password, sudo } = req.body;
  if (!clientId || !username || !password)
    return res
      .status(400)
      .json({ error: "clientId, username, and password required" });
  if (!/^[a-zA-Z0-9_-]+$/.test(username))
    return res.status(400).json({ error: "Invalid username" });
  try {
    await execOnTerminal(clientId, `useradd -m '${sanitizePath(username)}'`);
    await execOnTerminal(
      clientId,
      `echo '${sanitizePath(username)}:${sanitizePath(password)}' | chpasswd`,
    );
    if (sudo) {
      await execOnTerminal(
        clientId,
        `usermod -aG sudo '${sanitizePath(username)}' 2>/dev/null || usermod -aG wheel '${sanitizePath(username)}' 2>/dev/null`,
      ).catch(() => {});
    }
    logAudit(
      "user_add",
      `Added user: ${username}${sudo ? " (sudo)" : ""}`,
      "",
      req,
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/users/delete", requireAuth, async (req, res) => {
  const { clientId, username } = req.body;
  if (!clientId || !username)
    return res.status(400).json({ error: "clientId and username required" });
  if (username === "root")
    return res.status(400).json({ error: "Cannot delete root user" });
  try {
    await execOnTerminal(
      clientId,
      `userdel -r '${sanitizePath(username)}' 2>/dev/null || userdel '${sanitizePath(username)}'`,
    );
    logAudit("user_delete", `Deleted user: ${username}`, "", req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/users/sudo", requireAuth, async (req, res) => {
  const { clientId, username, enable } = req.body;
  if (!clientId || !username)
    return res.status(400).json({ error: "clientId and username required" });
  try {
    if (enable) {
      await execOnTerminal(
        clientId,
        `usermod -aG sudo '${sanitizePath(username)}' 2>/dev/null || usermod -aG wheel '${sanitizePath(username)}' 2>/dev/null`,
      );
    } else {
      await execOnTerminal(
        clientId,
        `gpasswd -d '${sanitizePath(username)}' sudo 2>/dev/null; gpasswd -d '${sanitizePath(username)}' wheel 2>/dev/null`,
      ).catch(() => {});
    }
    logAudit(
      "user_sudo_toggle",
      `${enable ? "Enabled" : "Disabled"} sudo for: ${username}`,
      "",
      req,
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SSH KEY MANAGEMENT ROUTES ──

app.post("/api/ssh-keys", requireAuth, async (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  try {
    const output = await execOnTerminal(
      clientId,
      "cat ~/.ssh/authorized_keys 2>/dev/null",
    ).catch(() => "");
    const keys = output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line, idx) => {
        const parts = line.trim().split(/\s+/);
        return {
          lineIndex: idx,
          type: parts[0] || "unknown",
          key: parts[1] ? parts[1].substring(0, 20) + "..." : "",
          comment: parts.slice(2).join(" ") || "",
          full: line.trim(),
        };
      });
    res.json({ success: true, keys });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/ssh-keys/add", requireAuth, async (req, res) => {
  const { clientId, publicKey } = req.body;
  if (!clientId || !publicKey)
    return res.status(400).json({ error: "clientId and publicKey required" });
  if (!/^(ssh-rsa|ssh-ed25519|ecdsa-sha2|ssh-dss)\s/.test(publicKey.trim())) {
    return res.status(400).json({ error: "Invalid SSH public key format" });
  }
  try {
    await execOnTerminal(clientId, "mkdir -p ~/.ssh && chmod 700 ~/.ssh");
    const safeKey = publicKey.trim().replace(/'/g, "'\\''");
    await execOnTerminal(
      clientId,
      `echo '${safeKey}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`,
    );
    logAudit("ssh_key_add", "Added SSH public key", "", req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/ssh-keys/delete", requireAuth, async (req, res) => {
  const { clientId, lineIndex } = req.body;
  if (!clientId || lineIndex === undefined)
    return res.status(400).json({ error: "clientId and lineIndex required" });
  try {
    const lineNum = parseInt(lineIndex) + 1;
    await execOnTerminal(
      clientId,
      `sed -i '${lineNum}d' ~/.ssh/authorized_keys`,
    );
    logAudit("ssh_key_delete", `Deleted SSH key at line ${lineNum}`, "", req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DOCKER MANAGEMENT ROUTES ──

const dockerLogStreams = new Map();
const dockerShellStreams = new Map();

app.post("/api/docker/check", requireAuth, async (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  try {
    const output = await execOnTerminal(
      clientId,
      'docker version --format "{{.Server.Version}}" 2>/dev/null',
    );
    const dockerVersion = output.trim().split("\n")[0] || "";
    let composeVersion = "";
    try {
      const cv = await execOnTerminal(
        clientId,
        "docker compose version --short 2>/dev/null || docker-compose --version 2>/dev/null",
      );
      composeVersion = cv.trim().split("\n")[0] || "";
    } catch (_) {}
    res.json({
      success: true,
      installed: !!dockerVersion,
      dockerVersion,
      composeVersion,
      hasCompose: !!composeVersion,
    });
  } catch (err) {
    res.json({
      success: true,
      installed: false,
      dockerVersion: "",
      composeVersion: "",
      hasCompose: false,
    });
  }
});

app.post("/api/docker/containers", requireAuth, async (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  try {
    const [containersOut, statsOut] = await Promise.all([
      execOnTerminal(
        clientId,
        "docker ps -a --format '{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}|{{.State}}|{{.CreatedAt}}|{{.Size}}'",
      ),
      execOnTerminal(
        clientId,
        "docker stats --no-stream --format '{{.Container}}|{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}|{{.NetIO}}|{{.BlockIO}}|{{.PIDs}}'",
      ).catch(() => ""),
    ]);
    const containers = parseDockerContainers(containersOut);
    const stats = parseDockerStats(statsOut);
    const statsMap = new Map();
    for (const s of stats) {
      statsMap.set(s.containerId, s);
      statsMap.set(s.name, s);
    }
    for (const c of containers) {
      const s = statsMap.get(c.id) || statsMap.get(c.name);
      if (s) {
        c.cpu = s.cpuPercent;
        c.mem = s.memPercent;
        c.memUsage = s.memUsage;
        c.netIO = s.netIO;
        c.blockIO = s.blockIO;
        c.pids = s.pids;
      }
    }
    res.json({ success: true, containers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/docker/container/action", requireAuth, async (req, res) => {
  const { clientId, containerId, action } = req.body;
  if (!clientId || !containerId || !action)
    return res
      .status(400)
      .json({ error: "clientId, containerId, and action required" });
  const validActions = [
    "start",
    "stop",
    "restart",
    "pause",
    "unpause",
    "remove",
  ];
  if (!validActions.includes(action))
    return res.status(400).json({ error: "Invalid action" });
  const safeId = sanitizePath(containerId);
  const cmd =
    action === "remove"
      ? `docker rm --force ${safeId}`
      : `docker ${action} ${safeId}`;
  try {
    await execOnTerminal(clientId, cmd);
    logAudit("docker_" + action, `Docker ${action}: ${containerId}`, "", req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/docker/container/inspect", requireAuth, async (req, res) => {
  const { clientId, containerId } = req.body;
  if (!clientId || !containerId)
    return res.status(400).json({ error: "clientId and containerId required" });
  try {
    const output = await execOnTerminal(
      clientId,
      `docker inspect ${sanitizePath(containerId)} 2>/dev/null`,
    );
    const inspectData = parseDockerInspect(output);
    res.json({ success: true, inspect: inspectData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/docker/container/health", requireAuth, async (req, res) => {
  const { clientId, containerId } = req.body;
  if (!clientId || !containerId)
    return res.status(400).json({ error: "clientId and containerId required" });
  try {
    const output = await execOnTerminal(
      clientId,
      `docker inspect --format '{{json .State.Health}}' ${sanitizePath(containerId)} 2>/dev/null`,
    );
    const health = JSON.parse(output.trim() || "null");
    res.json({ success: true, health });
  } catch (err) {
    res.json({ success: true, health: null });
  }
});

app.post("/api/docker/container/env", requireAuth, async (req, res) => {
  const { clientId, containerIds } = req.body;
  if (!clientId || !containerIds || !containerIds.length)
    return res
      .status(400)
      .json({ error: "clientId and containerIds required" });
  try {
    const envResults = {};
    for (const id of containerIds.slice(0, 10)) {
      const output = await execOnTerminal(
        clientId,
        `docker inspect --format '{{json .Config.Env}}' ${sanitizePath(id)} 2>/dev/null`,
      );
      envResults[id] = JSON.parse(output.trim() || "[]");
    }
    res.json({ success: true, envVars: envResults });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/docker/container/logs", requireAuth, async (req, res) => {
  const { clientId, containerId, tail, filter } = req.body;
  if (!clientId || !containerId)
    return res.status(400).json({ error: "clientId and containerId required" });
  const safeTail = parseInt(tail) || 200;
  const safeId = sanitizePath(containerId);
  try {
    const output = await execOnTerminal(
      clientId,
      `docker logs --tail ${safeTail} --timestamps ${safeId} 2>&1`,
    );
    let lines = output.split("\n");
    if (filter) {
      const q = filter.toLowerCase();
      lines = lines.filter((l) => l.toLowerCase().includes(q));
    }
    res.json({
      success: true,
      logs: lines.join("\n"),
      lineCount: lines.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/docker/images", requireAuth, async (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  try {
    const output = await execOnTerminal(
      clientId,
      "docker images --format '{{.Repository}}|{{.Tag}}|{{.ID}}|{{.CreatedSince}}|{{.Size}}'",
    );
    const images = parseDockerImages(output);
    res.json({ success: true, images });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/docker/images/pull", requireAuth, async (req, res) => {
  const { clientId, imageName } = req.body;
  if (!clientId || !imageName)
    return res.status(400).json({ error: "clientId and imageName required" });
  try {
    const output = await execOnTerminal(
      clientId,
      `docker pull ${sanitizePath(imageName)} 2>&1`,
    );
    logAudit("docker_pull", `Pulled image: ${imageName}`, "", req);
    res.json({ success: true, output });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/docker/images/remove", requireAuth, async (req, res) => {
  const { clientId, imageId } = req.body;
  if (!clientId || !imageId)
    return res.status(400).json({ error: "clientId and imageId required" });
  try {
    await execOnTerminal(clientId, `docker rmi ${sanitizePath(imageId)} 2>&1`);
    logAudit("docker_image_remove", `Removed image: ${imageId}`, "", req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/docker/images/layers", requireAuth, async (req, res) => {
  const { clientId, imageId } = req.body;
  if (!clientId || !imageId)
    return res.status(400).json({ error: "clientId and imageId required" });
  try {
    const output = await execOnTerminal(
      clientId,
      `docker history --no-trunc --format '{{.CreatedBy}}|{{.Size}}|{{.CreatedAt}}' ${sanitizePath(imageId)} 2>/dev/null`,
    );
    const layers = output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const parts = line.split("|");
        return {
          createdBy: parts[0] || "",
          size: parts[1] || "",
          createdAt: parts[2] || "",
        };
      });
    res.json({ success: true, layers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/docker/compose/detect", requireAuth, async (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  try {
    const output = await execOnTerminal(
      clientId,
      "find / -maxdepth 4 \\( -name 'docker-compose.yml' -o -name 'docker-compose.yaml' -o -name 'compose.yml' -o -name 'compose.yaml' \\) 2>/dev/null | head -20",
    );
    const files = output.trim().split("\n").filter(Boolean);
    res.json({ success: true, composeFiles: files });
  } catch (err) {
    res.json({ success: true, composeFiles: [] });
  }
});

app.post("/api/docker/compose/status", requireAuth, async (req, res) => {
  const { clientId, composePath } = req.body;
  if (!clientId || !composePath)
    return res.status(400).json({ error: "clientId and composePath required" });
  try {
    const dir = sanitizePath(require("path").dirname(composePath));
    const output = await execOnTerminal(
      clientId,
      `cd '${dir}' && docker compose ps --format '{{.Name}}|{{.Service}}|{{.Status}}|{{.Ports}}|{{.State}}' 2>/dev/null`,
    );
    const services = parseDockerCompose(output);
    res.json({ success: true, services, composePath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/docker/compose/action", requireAuth, async (req, res) => {
  const { clientId, composePath, action } = req.body;
  if (!clientId || !composePath || !action)
    return res
      .status(400)
      .json({ error: "clientId, composePath, and action required" });
  const validActions = ["up -d", "down", "restart", "pull"];
  if (!validActions.includes(action))
    return res.status(400).json({ error: "Invalid action" });
  try {
    const dir = sanitizePath(require("path").dirname(composePath));
    const output = await execOnTerminal(
      clientId,
      `cd '${dir}' && docker compose ${action} 2>&1`,
    );
    logAudit(
      "docker_compose_" + action.split(" ")[0],
      `Compose ${action}: ${composePath}`,
      "",
      req,
    );
    res.json({ success: true, output });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/docker/system/prune", requireAuth, async (req, res) => {
  const { clientId, all } = req.body;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  const allFlag = all ? " --all" : "";
  try {
    const output = await execOnTerminal(
      clientId,
      `docker system prune --force${allFlag} 2>&1`,
    );
    logAudit("docker_prune", `Docker system prune${allFlag}`, "", req);
    res.json({ success: true, output });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/docker/system/df", requireAuth, async (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  try {
    const output = await execOnTerminal(
      clientId,
      "docker system df 2>/dev/null",
    );
    res.json({ success: true, usage: output });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/docker/volumes", requireAuth, async (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  try {
    const output = await execOnTerminal(
      clientId,
      "docker volume ls --format '{{.Name}}|{{.Driver}}|{{.Scope}}|{{.Mountpoint}}'",
    );
    const volumes = parseDockerVolumes(output);
    res.json({ success: true, volumes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/docker/volumes/inspect", requireAuth, async (req, res) => {
  const { clientId, volumeName } = req.body;
  if (!clientId || !volumeName)
    return res.status(400).json({ error: "clientId and volumeName required" });
  try {
    const output = await execOnTerminal(
      clientId,
      `docker volume inspect ${sanitizePath(volumeName)} 2>/dev/null`,
    );
    const inspect = JSON.parse(output);
    res.json({
      success: true,
      inspect: Array.isArray(inspect) ? inspect[0] : inspect,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/docker/volumes/create", requireAuth, async (req, res) => {
  const { clientId, name, driver } = req.body;
  if (!clientId || !name)
    return res.status(400).json({ error: "clientId and name required" });
  const driverFlag = driver ? ` --driver ${sanitizePath(driver)}` : "";
  try {
    await execOnTerminal(
      clientId,
      `docker volume create${driverFlag} ${sanitizePath(name)}`,
    );
    logAudit("docker_volume_create", `Created volume: ${name}`, "", req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/docker/volumes/remove", requireAuth, async (req, res) => {
  const { clientId, volumeName } = req.body;
  if (!clientId || !volumeName)
    return res.status(400).json({ error: "clientId and volumeName required" });
  try {
    await execOnTerminal(
      clientId,
      `docker volume rm ${sanitizePath(volumeName)}`,
    );
    logAudit("docker_volume_remove", `Removed volume: ${volumeName}`, "", req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/docker/networks", requireAuth, async (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  try {
    const output = await execOnTerminal(
      clientId,
      "docker network ls --format '{{.ID}}|{{.Name}}|{{.Driver}}|{{.Scope}}'",
    );
    const networks = parseDockerNetworks(output);
    res.json({ success: true, networks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/docker/networks/inspect", requireAuth, async (req, res) => {
  const { clientId, networkId } = req.body;
  if (!clientId || !networkId)
    return res.status(400).json({ error: "clientId and networkId required" });
  try {
    const output = await execOnTerminal(
      clientId,
      `docker network inspect ${sanitizePath(networkId)} 2>/dev/null`,
    );
    const inspect = JSON.parse(output);
    res.json({
      success: true,
      inspect: Array.isArray(inspect) ? inspect[0] : inspect,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/docker/networks/create", requireAuth, async (req, res) => {
  const { clientId, name, driver, subnet } = req.body;
  if (!clientId || !name)
    return res.status(400).json({ error: "clientId and name required" });
  let cmd = "docker network create";
  if (driver) cmd += ` --driver ${sanitizePath(driver)}`;
  if (subnet) cmd += ` --subnet ${sanitizePath(subnet)}`;
  cmd += ` ${sanitizePath(name)}`;
  try {
    await execOnTerminal(clientId, cmd);
    logAudit("docker_network_create", `Created network: ${name}`, "", req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/docker/networks/remove", requireAuth, async (req, res) => {
  const { clientId, networkId } = req.body;
  if (!clientId || !networkId)
    return res.status(400).json({ error: "clientId and networkId required" });
  try {
    await execOnTerminal(
      clientId,
      `docker network rm ${sanitizePath(networkId)}`,
    );
    logAudit("docker_network_remove", `Removed network: ${networkId}`, "", req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/docker/networks/connect", requireAuth, async (req, res) => {
  const { clientId, networkId, containerId } = req.body;
  if (!clientId || !networkId || !containerId)
    return res
      .status(400)
      .json({ error: "clientId, networkId, and containerId required" });
  try {
    await execOnTerminal(
      clientId,
      `docker network connect ${sanitizePath(networkId)} ${sanitizePath(containerId)}`,
    );
    logAudit(
      "docker_network_connect",
      `Connected ${containerId} to network ${networkId}`,
      "",
      req,
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/docker/networks/disconnect", requireAuth, async (req, res) => {
  const { clientId, networkId, containerId } = req.body;
  if (!clientId || !networkId || !containerId)
    return res
      .status(400)
      .json({ error: "clientId, networkId, and containerId required" });
  try {
    await execOnTerminal(
      clientId,
      `docker network disconnect ${sanitizePath(networkId)} ${sanitizePath(containerId)}`,
    );
    logAudit(
      "docker_network_disconnect",
      `Disconnected ${containerId} from network ${networkId}`,
      "",
      req,
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SFTP FILE TRANSFER ROUTES ──

function getSftp(conn) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      resolve(sftp);
    });
  });
}

const sftpUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) =>
      cb(null, `sftp-${uuidv4()}-${file.originalname}`),
  }),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
});

app.post("/api/sftp/list", requireAuth, async (req, res) => {
  const { clientId, remotePath } = req.body;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  const session = terminals.get(clientId);
  if (!session || !session.conn)
    return res.status(400).json({ error: "No active SSH session" });

  try {
    const sftp = await getSftp(session.conn);
    sftp.readdir(remotePath || "/home", (err, list) => {
      if (err)
        return res
          .status(500)
          .json({ error: `Failed to list: ${err.message}` });
      const files = list
        .map((item) => ({
          name: item.filename,
          size: item.attrs.size,
          isDirectory: (item.attrs.mode & 0o40000) !== 0,
          permissions: "0" + (item.attrs.mode & 0o777).toString(8),
          modified: new Date(item.attrs.mtime * 1000).toISOString(),
          uid: item.attrs.uid,
          gid: item.attrs.gid,
        }))
        .sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      res.json({ success: true, files, path: remotePath || "/home" });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post(
  "/api/sftp/upload",
  requireAuth,
  sftpUpload.single("file"),
  async (req, res) => {
    const { clientId, remotePath } = req.body;
    if (!clientId || !req.file)
      return res.status(400).json({ error: "clientId and file required" });
    const session = terminals.get(clientId);
    if (!session || !session.conn)
      return res.status(400).json({ error: "No active SSH session" });

    const localPath = req.file.path;
    const remoteFile = `${remotePath || "/tmp"}/${req.file.originalname}`;

    try {
      const sftp = await getSftp(session.conn);
      const ws = clients.get(clientId);
      const totalSize = req.file.size;

      sftp.fastPut(
        localPath,
        remoteFile,
        {
          step: (transferred, chunk, total) => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: "sftp-progress",
                  direction: "upload",
                  filename: req.file.originalname,
                  transferred,
                  total,
                  percent: Math.round((transferred / total) * 100),
                }),
              );
            }
          },
        },
        (err) => {
          // Clean up temp file
          try {
            fs.unlinkSync(localPath);
          } catch (_) {}
          if (err)
            return res
              .status(500)
              .json({ error: `Upload failed: ${err.message}` });
          logAudit(
            "file_upload",
            `Uploaded ${req.file.originalname} to ${remoteFile}`,
            "",
            req,
          );
          res.json({ success: true, remotePath: remoteFile });
        },
      );
    } catch (err) {
      try {
        fs.unlinkSync(localPath);
      } catch (_) {}
      res.status(500).json({ error: err.message });
    }
  },
);

app.post("/api/sftp/download", requireAuth, async (req, res) => {
  const { clientId, remotePath } = req.body;
  if (!clientId || !remotePath)
    return res.status(400).json({ error: "clientId and remotePath required" });
  const session = terminals.get(clientId);
  if (!session || !session.conn)
    return res.status(400).json({ error: "No active SSH session" });

  const localPath = path.join(UPLOAD_DIR, `dl-${uuidv4()}`);

  try {
    const sftp = await getSftp(session.conn);
    sftp.fastGet(remotePath, localPath, (err) => {
      if (err)
        return res
          .status(500)
          .json({ error: `Download failed: ${err.message}` });
      const filename = path.basename(remotePath);
      logAudit("file_download", `Downloaded ${remotePath}`, "", req);
      res.download(localPath, filename, () => {
        try {
          fs.unlinkSync(localPath);
        } catch (_) {}
      });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/sftp/mkdir", requireAuth, async (req, res) => {
  const { clientId, remotePath } = req.body;
  if (!clientId || !remotePath)
    return res.status(400).json({ error: "clientId and remotePath required" });
  const session = terminals.get(clientId);
  if (!session || !session.conn)
    return res.status(400).json({ error: "No active SSH session" });

  try {
    const sftp = await getSftp(session.conn);
    sftp.mkdir(remotePath, (err) => {
      if (err)
        return res.status(500).json({ error: `mkdir failed: ${err.message}` });
      res.json({ success: true });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/sftp/delete", requireAuth, async (req, res) => {
  const { clientId, remotePath, isDirectory } = req.body;
  if (!clientId || !remotePath)
    return res.status(400).json({ error: "clientId and remotePath required" });
  const session = terminals.get(clientId);
  if (!session || !session.conn)
    return res.status(400).json({ error: "No active SSH session" });

  try {
    const sftp = await getSftp(session.conn);
    const fn = isDirectory ? sftp.rmdir.bind(sftp) : sftp.unlink.bind(sftp);
    fn(remotePath, (err) => {
      if (err)
        return res.status(500).json({ error: `Delete failed: ${err.message}` });
      logAudit("file_delete", `Deleted ${remotePath}`, "", req);
      res.json({ success: true });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Read a remote file via SFTP (for editor)
app.post("/api/sftp/read", requireAuth, async (req, res) => {
  const { clientId, remotePath } = req.body;
  if (!clientId || !remotePath)
    return res.status(400).json({ error: "clientId and remotePath required" });
  const session = terminals.get(clientId);
  if (!session || !session.conn)
    return res.status(400).json({ error: "No active SSH session" });

  try {
    const sftp = await getSftp(session.conn);

    // Check file size first
    const stats = await new Promise((resolve, reject) => {
      sftp.stat(remotePath, (err, s) => (err ? reject(err) : resolve(s)));
    });
    if (stats.size > 2 * 1024 * 1024) {
      return res.status(400).json({ error: "File too large (max 2MB)" });
    }

    // Read file content
    const content = await new Promise((resolve, reject) => {
      sftp.readFile(remotePath, (err, buf) =>
        err ? reject(err) : resolve(buf),
      );
    });

    // Check for binary (null bytes in first 8KB)
    const checkLen = Math.min(content.length, 8192);
    for (let i = 0; i < checkLen; i++) {
      if (content[i] === 0) {
        return res.status(400).json({ error: "Binary file — cannot edit" });
      }
    }

    res.json({
      success: true,
      content: content.toString("utf-8"),
      size: stats.size,
      path: remotePath,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Write a remote file via SFTP (from editor)
app.post("/api/sftp/write", requireAuth, async (req, res) => {
  const { clientId, remotePath, content } = req.body;
  if (!clientId || !remotePath)
    return res.status(400).json({ error: "clientId and remotePath required" });
  if (typeof content !== "string")
    return res.status(400).json({ error: "content is required" });
  const session = terminals.get(clientId);
  if (!session || !session.conn)
    return res.status(400).json({ error: "No active SSH session" });

  try {
    const sftp = await getSftp(session.conn);
    const buf = Buffer.from(content, "utf-8");
    await new Promise((resolve, reject) => {
      sftp.writeFile(remotePath, buf, (err) => (err ? reject(err) : resolve()));
    });
    logAudit(
      "file_edit",
      `Edited ${remotePath} (${buf.length} bytes)`,
      "",
      req,
    );
    res.json({ success: true, size: buf.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rename a remote file/directory via SFTP
app.post("/api/sftp/rename", requireAuth, async (req, res) => {
  const { clientId, oldPath, newPath } = req.body;
  if (!clientId || !oldPath || !newPath)
    return res
      .status(400)
      .json({ error: "clientId, oldPath, and newPath required" });
  const session = terminals.get(clientId);
  if (!session || !session.conn)
    return res.status(400).json({ error: "No active SSH session" });

  try {
    const sftp = await getSftp(session.conn);
    await new Promise((resolve, reject) => {
      sftp.rename(oldPath, newPath, (err) => (err ? reject(err) : resolve()));
    });
    logAudit("file_rename", `Renamed ${oldPath} to ${newPath}`, "", req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Change file permissions (chmod)
app.post("/api/sftp/chmod", requireAuth, async (req, res) => {
  const { clientId, remotePath, permissions } = req.body;
  if (!clientId || !remotePath || !permissions)
    return res
      .status(400)
      .json({ error: "clientId, remotePath, and permissions required" });
  if (!/^[0-7]{3,4}$/.test(permissions))
    return res
      .status(400)
      .json({ error: "Invalid permissions format (use octal e.g. 755)" });
  const session = terminals.get(clientId);
  if (!session || !session.conn)
    return res.status(400).json({ error: "No active SSH session" });

  try {
    const safePath = sanitizePath(remotePath);
    await execOnTerminal(clientId, `chmod ${permissions} '${safePath}'`);
    logAudit("file_chmod", `chmod ${permissions} ${remotePath}`, "", req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Change file ownership (chown)
app.post("/api/sftp/chown", requireAuth, async (req, res) => {
  const { clientId, remotePath, owner, group } = req.body;
  if (!clientId || !remotePath || !owner)
    return res
      .status(400)
      .json({ error: "clientId, remotePath, and owner required" });
  if (!/^[a-zA-Z0-9_-]+$/.test(owner))
    return res.status(400).json({ error: "Invalid owner name" });
  if (group && !/^[a-zA-Z0-9_-]+$/.test(group))
    return res.status(400).json({ error: "Invalid group name" });
  const session = terminals.get(clientId);
  if (!session || !session.conn)
    return res.status(400).json({ error: "No active SSH session" });

  try {
    const safePath = sanitizePath(remotePath);
    const ownerGroup = group ? `${owner}:${group}` : owner;
    await execOnTerminal(clientId, `chown ${ownerGroup} '${safePath}'`);
    logAudit("file_chown", `chown ${ownerGroup} ${remotePath}`, "", req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search remote files by name or content
app.post("/api/sftp/search", requireAuth, async (req, res) => {
  const {
    clientId,
    path: searchPath,
    query,
    searchContent,
    maxResults,
  } = req.body;
  if (!clientId || !query)
    return res.status(400).json({ error: "clientId and query required" });
  const session = terminals.get(clientId);
  if (!session || !session.conn)
    return res.status(400).json({ error: "No active SSH session" });

  try {
    const safePath = sanitizePath(searchPath || "/");
    const safeQuery = sanitizePath(query);
    const limit = Math.min(maxResults || 50, 100);
    let cmd;
    if (searchContent) {
      cmd = `grep -rl --include='*' '${safeQuery}' '${safePath}' 2>/dev/null | head -${limit}`;
    } else {
      cmd = `find '${safePath}' -maxdepth 5 -iname '*${safeQuery}*' 2>/dev/null | head -${limit}`;
    }
    const output = await execOnTerminal(clientId, cmd);
    const results = output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((p) => ({
        path: p,
        name: p.split("/").pop(),
        dir: p.substring(0, p.lastIndexOf("/")) || "/",
      }));
    res.json({ success: true, results });
  } catch (err) {
    res.json({ success: true, results: [] });
  }
});

// Copy a remote file/directory
app.post("/api/sftp/copy", requireAuth, async (req, res) => {
  const { clientId, srcPath, destPath } = req.body;
  if (!clientId || !srcPath || !destPath)
    return res
      .status(400)
      .json({ error: "clientId, srcPath, and destPath required" });
  const session = terminals.get(clientId);
  if (!session || !session.conn)
    return res.status(400).json({ error: "No active SSH session" });

  try {
    const safeSrc = sanitizePath(srcPath);
    const safeDest = sanitizePath(destPath);
    await execOnTerminal(clientId, `cp -r '${safeSrc}' '${safeDest}'`);
    logAudit("file_copy", `Copied ${srcPath} to ${destPath}`, "", req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Move a remote file/directory
app.post("/api/sftp/move", requireAuth, async (req, res) => {
  const { clientId, srcPath, destPath } = req.body;
  if (!clientId || !srcPath || !destPath)
    return res
      .status(400)
      .json({ error: "clientId, srcPath, and destPath required" });
  const session = terminals.get(clientId);
  if (!session || !session.conn)
    return res.status(400).json({ error: "No active SSH session" });

  try {
    const sftp = await getSftp(session.conn);
    await new Promise((resolve, reject) => {
      sftp.rename(srcPath, destPath, (err) => {
        if (err) {
          // Fallback for cross-device moves
          const safeSrc = sanitizePath(srcPath);
          const safeDest = sanitizePath(destPath);
          execOnTerminal(clientId, `mv '${safeSrc}' '${safeDest}'`)
            .then(resolve)
            .catch(reject);
        } else {
          resolve();
        }
      });
    });
    logAudit("file_move", `Moved ${srcPath} to ${destPath}`, "", req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Gather system resources via SSH
app.post("/api/resources", requireAuth, async (req, res) => {
  const { ec2Host, username, pemKeyPath, password, clientId } = req.body;

  const cmd =
    'uname -srm; uptime; free -b 2>/dev/null || vm_stat 2>/dev/null; df -B1 / 2>/dev/null || df -k / 2>/dev/null; cat /proc/cpuinfo 2>/dev/null | grep "model name" | head -1; nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null';

  // If we have an active terminal session, reuse it
  if (clientId && terminals.has(clientId)) {
    try {
      const output = await execOnTerminal(clientId, cmd);
      const resources = parseResourceOutput(output);
      return res.json({ success: true, resources });
    } catch (err) {
      // Fall through to one-shot connection
    }
  }

  if (!ec2Host) {
    return res.status(400).json({ error: "EC2 Host is required" });
  }

  const conn = new SSHClient();

  conn.on("ready", () => {
    const cmd =
      'uname -srm; uptime; free -b 2>/dev/null || vm_stat 2>/dev/null; df -B1 / 2>/dev/null || df -k / 2>/dev/null; cat /proc/cpuinfo 2>/dev/null | grep "model name" | head -1; nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null';

    conn.exec(cmd, (err, stream) => {
      if (err) {
        conn.end();
        return res
          .status(500)
          .json({ error: "Failed to execute resource commands" });
      }

      let output = "";
      let stderr = "";

      stream.on("data", (data) => {
        output += data.toString();
      });
      stream.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      stream.on("close", () => {
        conn.end();

        try {
          const resources = parseResourceOutput(output);
          res.json({ success: true, resources });
        } catch (parseErr) {
          console.error("Resource parse error:", parseErr, "Output:", output);
          res.json({
            success: true,
            resources: { raw: output, parseError: true },
          });
        }
      });
    });
  });

  conn.on("error", (err) => {
    res.status(500).json({ error: `SSH connection failed: ${err.message}` });
  });

  const connectConfig = {
    host: ec2Host,
    port: 22,
    username: username || "ec2-user",
    readyTimeout: 10000,
    keepaliveInterval: 0,
  };

  if (pemKeyPath && fs.existsSync(pemKeyPath)) {
    try {
      connectConfig.privateKey = fs.readFileSync(pemKeyPath);
    } catch (_) {}
  }
  if (password) {
    connectConfig.password = password;
  }

  conn.connect(connectConfig);
});

// Parse resource command output into structured JSON
function parseResourceOutput(output) {
  const lines = output.trim().split("\n");
  const result = {
    hostname: "",
    kernel: "",
    arch: "",
    uptime: "",
    loadAvg: [],
    memory: { total: 0, used: 0, free: 0, available: 0 },
    disk: { total: 0, used: 0, available: 0, usePercent: 0 },
    cpu: { model: "Unknown", cores: 1 },
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // uname -srm: "Linux 5.15.0-1049-aws x86_64"
    if (line.match(/^(Linux|Darwin)\s/)) {
      const parts = line.split(/\s+/);
      result.kernel = parts.slice(0, 2).join(" ");
      result.arch = parts[2] || "";
    }

    // uptime: " 14:22:01 up 14 days, 3:22,  1 user,  load average: 0.12, 0.08, 0.05"
    if (line.includes("load average")) {
      const loadMatch = line.match(
        /load average[s]?:\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/,
      );
      if (loadMatch) {
        result.loadAvg = [
          parseFloat(loadMatch[1]),
          parseFloat(loadMatch[2]),
          parseFloat(loadMatch[3]),
        ];
      }
      const uptimeMatch = line.match(/up\s+(.+?),\s+\d+\s+user/);
      if (uptimeMatch) {
        result.uptime = uptimeMatch[1].trim();
      }
    }

    // free -b: parse Mem: line
    if (line.startsWith("Mem:")) {
      const parts = line.split(/\s+/);
      result.memory.total = parseInt(parts[1]) || 0;
      result.memory.used = parseInt(parts[2]) || 0;
      result.memory.free = parseInt(parts[3]) || 0;
      result.memory.available = parseInt(parts[6]) || parseInt(parts[3]) || 0;
    }

    // df -B1 /: parse filesystem line (second line of df output)
    if (line.match(/^\//)) {
      const parts = line.split(/\s+/);
      if (parts.length >= 5) {
        result.disk.total = parseInt(parts[1]) || 0;
        result.disk.used = parseInt(parts[2]) || 0;
        result.disk.available = parseInt(parts[3]) || 0;
        const pctMatch = parts[4].match(/(\d+)%/);
        result.disk.usePercent = pctMatch ? parseInt(pctMatch[1]) : 0;
      }
    }

    // CPU model name
    if (line.includes("model name")) {
      const modelMatch = line.match(/model name\s*:\s*(.+)/);
      if (modelMatch) {
        result.cpu.model = modelMatch[1].trim();
      }
    }

    // nproc output (just a number)
    if (line.match(/^\d+$/) && !line.includes("/") && parseInt(line) <= 256) {
      result.cpu.cores = parseInt(line);
    }
  }

  return result;
}

// ── PHASE 1: SYSTEM INFO, HOSTNAME/TIMEZONE, SWAP ──

app.post("/api/system-info", requireAuth, async (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  try {
    const cmd = [
      "cat /etc/os-release 2>/dev/null | head -10",
      'ip -o addr show 2>/dev/null | grep "scope global" || ifconfig 2>/dev/null | grep "inet " | head -10',
      'echo "---SEPARATOR---"',
      'curl -s --max-time 3 http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || curl -s --max-time 3 https://ifconfig.me 2>/dev/null || echo "N/A"',
      'echo "---SEPARATOR---"',
      'python3 --version 2>/dev/null || echo "N/A"; node --version 2>/dev/null || echo "N/A"; java -version 2>&1 | head -1 || echo "N/A"; go version 2>/dev/null || echo "N/A"; docker --version 2>/dev/null || echo "N/A"',
      'echo "---SEPARATOR---"',
      'systemctl list-units --type=service --state=running --no-pager --no-legend 2>/dev/null | wc -l || echo "0"',
    ].join("; ");
    const output = await execOnTerminal(clientId, cmd);
    const sections = output.split("---SEPARATOR---");

    const osInfo = {};
    (sections[0] || "").split("\n").forEach((line) => {
      const match = line.match(/^(\w+)=["']?(.+?)["']?$/);
      if (match) osInfo[match[1]] = match[2];
    });

    const interfaces = (sections[0] || "")
      .split("\n")
      .filter((l) => l.includes("inet") || l.includes("scope global"))
      .map((l) => l.trim())
      .slice(0, 10);

    const publicIp = (sections[1] || "").trim() || "N/A";

    const runtimes = {};
    (sections[2] || "").split("\n").forEach((line) => {
      const l = line.trim();
      if (!l || l === "N/A") return;
      if (l.includes("Python")) runtimes.python = l;
      else if (l.startsWith("v") && /^v\d/.test(l)) runtimes.node = l;
      else if (l.includes("java") || l.includes("openjdk")) runtimes.java = l;
      else if (l.includes("go version")) runtimes.go = l;
      else if (l.includes("Docker version")) runtimes.docker = l;
    });

    const serviceCount = parseInt((sections[3] || "0").trim()) || 0;

    res.json({
      success: true,
      systemInfo: { os: osInfo, interfaces, publicIp, runtimes, serviceCount },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/system/hostname-timezone", requireAuth, async (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  try {
    const output = await execOnTerminal(
      clientId,
      'hostname; echo "---SEP---"; timedatectl 2>/dev/null || date',
    );
    const parts = output.split("---SEP---");
    const hostname = (parts[0] || "").trim();
    const tzOutput = (parts[1] || "").trim();

    let timezone = "Unknown";
    const tzMatch = tzOutput.match(/Time zone:\s*(.+?)[\s(]/);
    if (tzMatch) timezone = tzMatch[1];

    let localTime = "";
    const ltMatch = tzOutput.match(/Local time:\s*(.+)/);
    if (ltMatch) localTime = ltMatch[1].trim();

    res.json({ success: true, hostname, timezone, localTime, raw: tzOutput });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/system/set-hostname", requireAuth, async (req, res) => {
  const { clientId, hostname } = req.body;
  if (!clientId || !hostname)
    return res.status(400).json({ error: "clientId and hostname required" });
  if (!/^[a-zA-Z0-9.-]+$/.test(hostname) || hostname.length > 64) {
    return res
      .status(400)
      .json({
        error: "Invalid hostname (alphanumeric, hyphens, dots, max 64 chars)",
      });
  }
  try {
    await execOnTerminal(
      clientId,
      `hostnamectl set-hostname '${sanitizePath(hostname)}'`,
    );
    logAudit("set_hostname", `Hostname set to: ${hostname}`, "", req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/system/set-timezone", requireAuth, async (req, res) => {
  const { clientId, timezone } = req.body;
  if (!clientId || !timezone)
    return res.status(400).json({ error: "clientId and timezone required" });
  if (!VALID_TIMEZONES.includes(timezone)) {
    return res.status(400).json({ error: "Invalid timezone" });
  }
  try {
    await execOnTerminal(
      clientId,
      `timedatectl set-timezone '${sanitizePath(timezone)}'`,
    );
    logAudit("set_timezone", `Timezone set to: ${timezone}`, "", req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/system/swap-status", requireAuth, async (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  try {
    const output = await execOnTerminal(
      clientId,
      'swapon --show 2>/dev/null; echo "---SEP---"; free -b 2>/dev/null | grep -i swap',
    );
    const parts = output.split("---SEP---");
    const swapDevices = (parts[0] || "").trim();
    const swapLine = (parts[1] || "").trim();

    let swapTotal = 0,
      swapUsed = 0;
    if (swapLine) {
      const cols = swapLine.split(/\s+/);
      swapTotal = parseInt(cols[1]) || 0;
      swapUsed = parseInt(cols[2]) || 0;
    }

    res.json({
      success: true,
      swapDevices,
      swapTotal,
      swapUsed,
      hasSwap: swapTotal > 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/system/swap-create", requireAuth, async (req, res) => {
  const { clientId, sizeMB } = req.body;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  const validSizes = [256, 512, 1024, 2048, 4096];
  if (!validSizes.includes(sizeMB)) {
    return res
      .status(400)
      .json({
        error: "Invalid swap size. Use: 256, 512, 1024, 2048, or 4096 MB",
      });
  }
  try {
    const steps = [
      {
        cmd: `fallocate -l ${sizeMB}M /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=${sizeMB}`,
        msg: `Creating ${sizeMB}MB swap file...`,
      },
      { cmd: "chmod 600 /swapfile", msg: "Setting permissions..." },
      { cmd: "mkswap /swapfile", msg: "Formatting swap..." },
      { cmd: "swapon /swapfile", msg: "Activating swap..." },
      {
        cmd: 'grep -q "/swapfile" /etc/fstab || echo "/swapfile none swap sw 0 0" >> /etc/fstab',
        msg: "Making swap persistent...",
      },
    ];

    res.json({ success: true, message: "Swap creation started" });

    for (const step of steps) {
      sendLog(clientId, { type: "swap-progress", message: step.msg });
      try {
        await execOnTerminal(clientId, step.cmd);
        sendLog(clientId, { type: "swap-progress", message: "  OK" });
      } catch (err) {
        sendLog(clientId, {
          type: "swap-progress",
          message: "  FAILED: " + err.message,
          error: true,
        });
        sendLog(clientId, { type: "swap-complete", success: false });
        return;
      }
    }

    sendLog(clientId, { type: "swap-complete", success: true });
    logAudit("swap_create", `Created ${sizeMB}MB swap file`, "", req);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PHASE 2: PACKAGE MANAGEMENT ──

app.post("/api/packages/list", requireAuth, async (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  try {
    const { pkgManager } = await detectDistro(clientId);
    let cmd;
    if (pkgManager === "apt") {
      cmd =
        "dpkg-query -W -f='${Package}|${Version}|${db:Status-Status}|${Installed-Size}\\n' 2>/dev/null | head -500";
    } else {
      cmd =
        "rpm -qa --queryformat '%{NAME}|%{VERSION}-%{RELEASE}|installed|%{SIZE}\\n' 2>/dev/null | sort | head -500";
    }
    const output = await execOnTerminal(clientId, cmd);
    const packages = output
      .trim()
      .split("\n")
      .filter((l) => l.includes("|"))
      .map((line) => {
        const [name, version, status, size] = line.split("|");
        return {
          name,
          version,
          status: status || "installed",
          size: parseInt(size) || 0,
        };
      });
    res.json({ success: true, packages, pkgManager });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/packages/search", requireAuth, async (req, res) => {
  const { clientId, query } = req.body;
  if (!clientId || !query)
    return res.status(400).json({ error: "clientId and query required" });
  const safe = sanitizePath(query);
  try {
    const { pkgManager } = await detectDistro(clientId);
    let cmd;
    if (pkgManager === "apt") {
      cmd = `apt-cache search '${safe}' 2>/dev/null | head -50`;
    } else {
      cmd = `${pkgManager} search '${safe}' 2>/dev/null | grep -E '^[a-zA-Z]' | head -50`;
    }
    const output = await execOnTerminal(clientId, cmd);
    const results = output
      .trim()
      .split("\n")
      .filter((l) => l.trim())
      .map((line) => {
        const parts = line.split(/\s+-\s+|\s+:\s+/);
        return {
          name: (parts[0] || "").trim().split(/\s/)[0],
          description: (parts[1] || "").trim(),
        };
      })
      .filter((r) => r.name);
    res.json({ success: true, results, pkgManager });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/packages/info", requireAuth, async (req, res) => {
  const { clientId, packageName } = req.body;
  if (!clientId || !packageName)
    return res.status(400).json({ error: "clientId and packageName required" });
  if (!/^[a-zA-Z0-9._+:-]+$/.test(packageName))
    return res.status(400).json({ error: "Invalid package name" });
  try {
    const { pkgManager } = await detectDistro(clientId);
    const cmd =
      pkgManager === "apt"
        ? `apt-cache show '${sanitizePath(packageName)}' 2>/dev/null | head -30`
        : `${pkgManager} info '${sanitizePath(packageName)}' 2>/dev/null | head -30`;
    const output = await execOnTerminal(clientId, cmd);
    res.json({ success: true, info: output.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/packages/install", requireAuth, async (req, res) => {
  const { clientId, packageName } = req.body;
  if (!clientId || !packageName)
    return res.status(400).json({ error: "clientId and packageName required" });
  if (!/^[a-zA-Z0-9._+-]+$/.test(packageName))
    return res.status(400).json({ error: "Invalid package name" });
  try {
    const { pkgManager } = await detectDistro(clientId);
    const safe = sanitizePath(packageName);
    let cmd;
    if (pkgManager === "apt") {
      cmd = `DEBIAN_FRONTEND=noninteractive apt-get install -y '${safe}' 2>&1`;
    } else {
      cmd = `${pkgManager} install -y '${safe}' 2>&1`;
    }

    const session = terminals.get(clientId);
    if (!session || !session.conn)
      return res.status(400).json({ error: "No active SSH session" });

    res.json({ success: true, message: `Installing ${packageName}...` });

    session.conn.exec(cmd, (err, stream) => {
      if (err) {
        sendLog(clientId, {
          type: "package-install-progress",
          data: "Error: " + err.message,
          done: true,
          success: false,
        });
        return;
      }
      stream.on("data", (d) => {
        sendLog(clientId, {
          type: "package-install-progress",
          data: d.toString("utf-8"),
        });
      });
      stream.stderr.on("data", (d) => {
        sendLog(clientId, {
          type: "package-install-progress",
          data: d.toString("utf-8"),
        });
      });
      stream.on("close", (code) => {
        sendLog(clientId, {
          type: "package-install-progress",
          done: true,
          success: code === 0,
          packageName,
        });
        logAudit(
          "package_install",
          `Installed package: ${packageName} (exit: ${code})`,
          "",
          req,
        );
      });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/packages/uninstall", requireAuth, async (req, res) => {
  const { clientId, packageName } = req.body;
  if (!clientId || !packageName)
    return res.status(400).json({ error: "clientId and packageName required" });
  if (!/^[a-zA-Z0-9._+-]+$/.test(packageName))
    return res.status(400).json({ error: "Invalid package name" });
  try {
    const { pkgManager } = await detectDistro(clientId);
    const safe = sanitizePath(packageName);
    const cmd =
      pkgManager === "apt"
        ? `DEBIAN_FRONTEND=noninteractive apt-get remove -y '${safe}' 2>&1`
        : `${pkgManager} remove -y '${safe}' 2>&1`;
    const output = await execOnTerminal(clientId, cmd);
    logAudit("package_uninstall", `Removed package: ${packageName}`, "", req);
    res.json({ success: true, output });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PHASE 2: DOCKER INSTALL ──

app.post("/api/docker/install", requireAuth, async (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  try {
    const { id: distro, pkgManager } = await detectDistro(clientId);
    const session = terminals.get(clientId);
    if (!session || !session.conn)
      return res.status(400).json({ error: "No active SSH session" });

    let installCmd;
    if (["ubuntu", "debian"].includes(distro)) {
      installCmd =
        "apt-get update 2>&1 && DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-plugin 2>&1; systemctl start docker; systemctl enable docker";
    } else if (distro === "amzn") {
      installCmd =
        "yum install -y docker 2>&1 && systemctl start docker && systemctl enable docker";
    } else {
      installCmd = `${pkgManager} install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin 2>&1 || ${pkgManager} install -y docker 2>&1 && systemctl start docker && systemctl enable docker`;
    }

    res.json({ success: true, message: "Docker installation started" });

    session.conn.exec(installCmd, (err, stream) => {
      if (err) {
        sendLog(clientId, {
          type: "docker-install-progress",
          data: "Error: " + err.message,
        });
        sendLog(clientId, { type: "docker-install-complete", success: false });
        return;
      }
      stream.on("data", (d) => {
        sendLog(clientId, {
          type: "docker-install-progress",
          data: d.toString("utf-8"),
        });
      });
      stream.stderr.on("data", (d) => {
        sendLog(clientId, {
          type: "docker-install-progress",
          data: d.toString("utf-8"),
        });
      });
      stream.on("close", (code) => {
        sendLog(clientId, {
          type: "docker-install-complete",
          success: code === 0,
        });
        logAudit(
          "docker_install",
          "Docker installation " + (code === 0 ? "completed" : "failed"),
          "",
          req,
        );
      });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PHASE 3: SECURITY HARDENING ──

app.post("/api/security/status", requireAuth, async (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  try {
    const cmd = [
      "ss -tlnp 2>/dev/null | tail -n +2 | head -20",
      'echo "---SEC---"',
      'ufw status 2>/dev/null || firewall-cmd --state 2>/dev/null || echo "no-firewall"',
      'echo "---SEC---"',
      'fail2ban-client status 2>/dev/null || echo "not-installed"',
      'echo "---SEC---"',
      'grep -E "^(Port|PermitRootLogin|PasswordAuthentication|PubkeyAuthentication)" /etc/ssh/sshd_config 2>/dev/null',
      'echo "---SEC---"',
      'lastb 2>/dev/null | head -10 || journalctl -u sshd --since "24 hours ago" 2>/dev/null | grep -i "failed" | tail -10 || echo "none"',
    ].join("; ");
    const output = await execOnTerminal(clientId, cmd);
    const sections = output.split("---SEC---");

    const openPorts = (sections[0] || "")
      .trim()
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => {
        const parts = l.trim().split(/\s+/);
        return { proto: parts[0], local: parts[3], process: parts[5] || "" };
      });

    const firewallRaw = (sections[1] || "").trim();
    let firewallStatus = "unknown";
    if (firewallRaw.includes("Status: active") || firewallRaw === "running")
      firewallStatus = "active";
    else if (
      firewallRaw.includes("Status: inactive") ||
      firewallRaw === "not running"
    )
      firewallStatus = "inactive";
    else if (firewallRaw.includes("no-firewall"))
      firewallStatus = "not-installed";

    const fail2banRaw = (sections[2] || "").trim();
    const fail2banInstalled = !fail2banRaw.includes("not-installed");

    const sshConfig = {};
    (sections[3] || "")
      .trim()
      .split("\n")
      .forEach((l) => {
        const parts = l.trim().split(/\s+/);
        if (parts.length >= 2) sshConfig[parts[0]] = parts[1];
      });

    const failedLogins = (sections[4] || "").trim();

    res.json({
      success: true,
      security: {
        openPorts,
        firewallStatus,
        firewallRaw,
        fail2banInstalled,
        fail2banRaw,
        sshConfig,
        failedLogins,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/security/fail2ban/install", requireAuth, async (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  try {
    const { pkgManager } = await detectDistro(clientId);
    const cmd =
      pkgManager === "apt"
        ? "DEBIAN_FRONTEND=noninteractive apt-get install -y fail2ban && systemctl enable fail2ban && systemctl start fail2ban"
        : `${pkgManager} install -y fail2ban && systemctl enable fail2ban && systemctl start fail2ban`;

    const session = terminals.get(clientId);
    if (!session || !session.conn)
      return res.status(400).json({ error: "No active SSH session" });

    res.json({ success: true, message: "Installing fail2ban..." });

    session.conn.exec(cmd + " 2>&1", (err, stream) => {
      if (err)
        return sendLog(clientId, {
          type: "security-install-progress",
          done: true,
          success: false,
          data: err.message,
        });
      stream.on("data", (d) =>
        sendLog(clientId, {
          type: "security-install-progress",
          data: d.toString("utf-8"),
        }),
      );
      stream.stderr.on("data", (d) =>
        sendLog(clientId, {
          type: "security-install-progress",
          data: d.toString("utf-8"),
        }),
      );
      stream.on("close", (code) => {
        sendLog(clientId, {
          type: "security-install-progress",
          done: true,
          success: code === 0,
        });
        logAudit(
          "fail2ban_install",
          "Fail2ban installation " + (code === 0 ? "completed" : "failed"),
          "",
          req,
        );
      });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/security/firewall/enable", requireAuth, async (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  try {
    const { pkgManager } = await detectDistro(clientId);
    let cmd;
    if (pkgManager === "apt") {
      cmd =
        'apt-get install -y ufw && ufw default deny incoming && ufw default allow outgoing && ufw allow 22/tcp && echo "y" | ufw enable';
    } else {
      cmd = `${pkgManager} install -y firewalld && systemctl start firewalld && systemctl enable firewalld && firewall-cmd --permanent --add-service=ssh && firewall-cmd --reload`;
    }

    const session = terminals.get(clientId);
    if (!session || !session.conn)
      return res.status(400).json({ error: "No active SSH session" });

    res.json({ success: true, message: "Enabling firewall..." });

    session.conn.exec(cmd + " 2>&1", (err, stream) => {
      if (err)
        return sendLog(clientId, {
          type: "security-install-progress",
          done: true,
          success: false,
          data: err.message,
        });
      stream.on("data", (d) =>
        sendLog(clientId, {
          type: "security-install-progress",
          data: d.toString("utf-8"),
        }),
      );
      stream.stderr.on("data", (d) =>
        sendLog(clientId, {
          type: "security-install-progress",
          data: d.toString("utf-8"),
        }),
      );
      stream.on("close", (code) => {
        sendLog(clientId, {
          type: "security-install-progress",
          done: true,
          success: code === 0,
        });
        logAudit(
          "firewall_enable",
          "Firewall " + (code === 0 ? "enabled" : "failed"),
          "",
          req,
        );
      });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/security/firewall/rule", requireAuth, async (req, res) => {
  const { clientId, port, action } = req.body;
  if (!clientId || !port)
    return res.status(400).json({ error: "clientId and port required" });
  const portNum = parseInt(port);
  if (isNaN(portNum) || portNum < 1 || portNum > 65535)
    return res.status(400).json({ error: "Invalid port number" });
  const act = action === "deny" ? "deny" : "allow";
  try {
    const { pkgManager } = await detectDistro(clientId);
    let cmd;
    if (pkgManager === "apt") {
      cmd = `ufw ${act} ${portNum}/tcp 2>&1`;
    } else {
      if (act === "allow") {
        cmd = `firewall-cmd --permanent --add-port=${portNum}/tcp && firewall-cmd --reload 2>&1`;
      } else {
        cmd = `firewall-cmd --permanent --remove-port=${portNum}/tcp && firewall-cmd --reload 2>&1`;
      }
    }
    const output = await execOnTerminal(clientId, cmd);
    logAudit("firewall_rule", `${act} port ${portNum}/tcp`, "", req);
    res.json({ success: true, output });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/security/ssh/port", requireAuth, async (req, res) => {
  const { clientId, port } = req.body;
  if (!clientId || !port)
    return res.status(400).json({ error: "clientId and port required" });
  const portNum = parseInt(port);
  if (isNaN(portNum) || portNum < 1024 || portNum > 65535)
    return res.status(400).json({ error: "Port must be 1024-65535" });
  try {
    const cmd = [
      `sed -i '/^#*Port /d' /etc/ssh/sshd_config`,
      `echo "Port ${portNum}" >> /etc/ssh/sshd_config`,
      `ufw allow ${portNum}/tcp 2>/dev/null; firewall-cmd --permanent --add-port=${portNum}/tcp 2>/dev/null; firewall-cmd --reload 2>/dev/null; true`,
      `systemctl restart sshd 2>/dev/null || systemctl restart ssh 2>/dev/null`,
    ].join(" && ");
    await execOnTerminal(clientId, cmd);
    logAudit("ssh_port_change", `SSH port changed to ${portNum}`, "", req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/security/ssh/disable-root", requireAuth, async (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  try {
    const cmd = [
      `sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config`,
      `systemctl restart sshd 2>/dev/null || systemctl restart ssh 2>/dev/null`,
    ].join(" && ");
    await execOnTerminal(clientId, cmd);
    logAudit("disable_root_login", "Root login disabled", "", req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PHASE 3: CLOUD-INIT LOG VIEWER ──

app.post("/api/cloud-init/log", requireAuth, async (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  try {
    const output = await execOnTerminal(
      clientId,
      'cat /var/log/cloud-init-output.log 2>/dev/null || echo "NOT_FOUND"',
    );
    if (output.trim() === "NOT_FOUND") {
      return res.json({ success: true, found: false, content: "" });
    }
    res.json({ success: true, found: true, content: output });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PHASE 4: INSTANCE INVENTORY ──

app.post("/api/sessions/inventory", requireAuth, (req, res) => {
  try {
    const sessions = db
      .prepare(
        `
            SELECT id, host, username, mode, auth_method, pem_filename, name,
                   CASE WHEN pem_content IS NOT NULL THEN 1 ELSE 0 END AS has_pem,
                   status, timestamp, created_at, health_status, last_checked,
                   os_detected, last_connected, connection_result
            FROM sessions ORDER BY last_connected DESC, timestamp DESC
        `,
      )
      .all();
    res.json({ success: true, sessions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/sessions/bulk", requireAuth, (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids))
    return res.status(400).json({ error: "ids array required" });
  try {
    const stmt = db.prepare("DELETE FROM sessions WHERE id = ?");
    const deleteMany = db.transaction((ids) => {
      for (const id of ids) stmt.run(id);
    });
    deleteMany(ids);
    logAudit("session_bulk_delete", `Deleted ${ids.length} sessions`, "", req);
    res.json({ success: true, deleted: ids.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PHASE 4: SSH KEY ROTATION ──

app.post("/api/ssh-keys/generate", requireAuth, (req, res) => {
  try {
    const crypto = require("crypto");
    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 4096,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    // Convert public key to OpenSSH format for authorized_keys
    const sshPub = require("crypto")
      .createPublicKey(publicKey)
      .export({ type: "spki", format: "der" });
    const sshPubB64 = sshPub.toString("base64");

    const token = uuidv4();
    tempKeyPairs.set(token, { privateKey, publicKey, created: Date.now() });

    // Cleanup after 10 minutes
    setTimeout(() => tempKeyPairs.delete(token), 10 * 60 * 1000);

    logAudit("ssh_key_generate", "Generated new SSH key pair", "", req);
    res.json({ success: true, publicKey, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/ssh-keys/deploy", requireAuth, async (req, res) => {
  const { clientId, publicKey } = req.body;
  if (!clientId || !publicKey)
    return res.status(400).json({ error: "clientId and publicKey required" });
  try {
    const safeKey = publicKey.replace(/'/g, "");
    const cmd = `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '${safeKey}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`;
    await execOnTerminal(clientId, cmd);
    logAudit("ssh_key_deploy", "Deployed SSH public key", "", req);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/ssh-keys/download/:token", requireAuth, (req, res) => {
  const { token } = req.params;
  const kp = tempKeyPairs.get(token);
  if (!kp) return res.status(404).json({ error: "Key not found or expired" });
  tempKeyPairs.delete(token);
  res.setHeader("Content-Type", "application/x-pem-file");
  res.setHeader("Content-Disposition", 'attachment; filename="ec2-key.pem"');
  res.send(kp.privateKey);
});

// ── PHASE 5: MULTI-INSTANCE BATCH ──

app.post("/api/batch/start", requireAuth, async (req, res) => {
  const { hosts, username, password, pemContent, operation, clientId } =
    req.body;
  if (!hosts || !Array.isArray(hosts) || hosts.length === 0)
    return res.status(400).json({ error: "hosts array required" });
  if (hosts.length > 20)
    return res.status(400).json({ error: "Maximum 20 hosts per batch" });
  if (!password) return res.status(400).json({ error: "password required" });

  const validOps = [
    "setup-password",
    "install-docker",
    "install-packages",
    "security-harden",
  ];
  if (!validOps.includes(operation))
    return res.status(400).json({ error: "Invalid operation" });

  const batchId = uuidv4();
  const results = {};
  hosts.forEach((h) => {
    results[h] = {
      status: "pending",
      logs: [],
      startedAt: null,
      endedAt: null,
    };
  });
  batchJobs.set(batchId, {
    hosts,
    results,
    startedAt: Date.now(),
    operation,
    cancelled: false,
  });

  res.json({ success: true, batchId });

  // Process hosts in parallel
  const processBatchHost = async (host) => {
    results[host].status = "running";
    results[host].startedAt = Date.now();
    sendLog(clientId, {
      type: "batch-host-progress",
      batchId,
      host,
      status: "running",
    });

    const conn = new SSHClient();
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        try {
          conn.end();
        } catch (_) {}
        results[host].status = "failed";
        results[host].logs.push("Connection timeout");
        results[host].endedAt = Date.now();
        sendLog(clientId, {
          type: "batch-host-progress",
          batchId,
          host,
          status: "failed",
          message: "Timeout",
        });
        resolve();
      }, 30000);

      conn.on("ready", async () => {
        clearTimeout(timeout);
        try {
          let cmd;
          if (operation === "setup-password") {
            const safePwd = password.replace(/'/g, "'\\''");
            cmd = `echo "root:${safePwd}" | chpasswd && sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config && sed -i 's/^#*PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config && systemctl restart sshd 2>/dev/null || systemctl restart ssh 2>/dev/null`;
          } else if (operation === "install-docker") {
            cmd =
              "command -v apt-get >/dev/null && (apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io) || yum install -y docker; systemctl start docker; systemctl enable docker";
          } else if (operation === "security-harden") {
            cmd =
              'command -v apt-get >/dev/null && (DEBIAN_FRONTEND=noninteractive apt-get install -y fail2ban ufw && ufw allow 22/tcp && echo "y" | ufw enable) || (yum install -y fail2ban firewalld && systemctl start firewalld && systemctl enable firewalld && firewall-cmd --permanent --add-service=ssh && firewall-cmd --reload); systemctl enable fail2ban && systemctl start fail2ban';
          } else {
            cmd = 'echo "Operation not supported in batch mode"';
          }

          const output = await new Promise((res, rej) => {
            conn.exec(cmd, (err, stream) => {
              if (err) return rej(err);
              let out = "";
              stream.on("data", (d) => {
                out += d.toString();
              });
              stream.stderr.on("data", (d) => {
                out += d.toString();
              });
              stream.on("close", (code) => {
                if (code !== 0) rej(new Error(out || `Exit code ${code}`));
                else res(out);
              });
            });
          });
          results[host].status = "success";
          results[host].logs.push(output.slice(0, 500));
          sendLog(clientId, {
            type: "batch-host-progress",
            batchId,
            host,
            status: "success",
          });
        } catch (err) {
          results[host].status = "failed";
          results[host].logs.push(err.message.slice(0, 500));
          sendLog(clientId, {
            type: "batch-host-progress",
            batchId,
            host,
            status: "failed",
            message: err.message.slice(0, 200),
          });
        } finally {
          results[host].endedAt = Date.now();
          conn.end();
          resolve();
        }
      });

      conn.on("error", (err) => {
        clearTimeout(timeout);
        results[host].status = "failed";
        results[host].logs.push(err.message);
        results[host].endedAt = Date.now();
        sendLog(clientId, {
          type: "batch-host-progress",
          batchId,
          host,
          status: "failed",
          message: err.message,
        });
        resolve();
      });

      const connectConfig = {
        host,
        port: 22,
        username: username || "ec2-user",
        readyTimeout: 15000,
        keepaliveInterval: 0,
      };
      if (pemContent) connectConfig.privateKey = pemContent;
      if (password) connectConfig.password = password;
      conn.connect(connectConfig);
    });
  };

  (async () => {
    await Promise.allSettled(hosts.map(processBatchHost));
    sendLog(clientId, { type: "batch-complete", batchId, results });
    logAudit(
      "batch_" + operation,
      `Batch ${operation} on ${hosts.length} hosts`,
      "",
      req,
    );
    // Cleanup after 1 hour
    setTimeout(() => batchJobs.delete(batchId), 60 * 60 * 1000);
  })();
});

app.get("/api/batch/status/:batchId", requireAuth, (req, res) => {
  const job = batchJobs.get(req.params.batchId);
  if (!job) return res.status(404).json({ error: "Batch not found" });
  res.json({ success: true, ...job });
});

app.post("/api/batch/cancel/:batchId", requireAuth, (req, res) => {
  const job = batchJobs.get(req.params.batchId);
  if (!job) return res.status(404).json({ error: "Batch not found" });
  job.cancelled = true;
  res.json({ success: true });
});
app.post("/api/test-connection", requireAuth, (req, res) => {
  const { ec2Host, username, pemKeyPath, clientId } = req.body;

  if (!ec2Host || !pemKeyPath) {
    return res.status(400).json({ error: "EC2 Host and PEM key are required" });
  }

  const user = username || "ec2-user";

  sendLog(clientId, {
    type: "log",
    level: "info",
    message: `Testing SSH connection to ${user}@${ec2Host}...`,
    timestamp: new Date().toISOString(),
  });

  const child = spawn("ssh", [
    "-i",
    pemKeyPath,
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "BatchMode=yes",
    `${user}@${ec2Host}`,
    'echo "Connection successful"',
  ]);

  let output = "";
  let error = "";

  child.stdout.on("data", (data) => {
    output += data.toString();
  });

  child.stderr.on("data", (data) => {
    error += data.toString();
  });

  child.on("close", (code) => {
    const success = code === 0;

    sendLog(clientId, {
      type: "log",
      level: success ? "success" : "error",
      message: success
        ? "✓ Connection successful!"
        : `✗ Connection failed: ${error}`,
      timestamp: new Date().toISOString(),
    });

    res.json({
      success: success,
      message: success ? "Connection successful" : "Connection failed",
      output: output,
      error: error,
    });
  });
});

// SSH terminal session via ssh2 (pure JavaScript)
app.post("/api/ssh-connect", requireAuth, (req, res) => {
  const { ec2Host, password, username, pemKeyPath, clientId } = req.body;

  if (!ec2Host) {
    return res
      .status(400)
      .json({ success: false, error: "EC2 Host is required" });
  }

  if (!clientId) {
    return res
      .status(400)
      .json({ success: false, error: "Client ID is required" });
  }

  // Kill any existing terminal for this client
  const existingSession = terminals.get(clientId);
  if (existingSession) {
    if (existingSession.stream) existingSession.stream.end();
    if (existingSession.conn) existingSession.conn.end();
    terminals.delete(clientId);
  }

  const wsClient = clients.get(clientId);
  if (!wsClient || wsClient.readyState !== WebSocket.OPEN) {
    console.error(
      `WebSocket lookup failed for clientId: ${clientId}, known clients: [${Array.from(clients.keys()).join(", ")}]`,
    );
    return res
      .status(400)
      .json({
        success: false,
        error:
          "WebSocket session expired. Please refresh the page and try again.",
      });
  }

  console.log(
    `SSH connect requested: ${username || "ec2-user"}@${ec2Host} [client: ${clientId}]`,
  );

  const conn = new SSHClient();

  conn.on("ready", () => {
    console.log(
      `SSH authenticated: ${username || "ec2-user"}@${ec2Host} [client: ${clientId}]`,
    );

    // Update session inventory data
    try {
      db.prepare(
        `UPDATE sessions SET last_connected = datetime('now'), connection_result = 'success' WHERE host = ?`,
      ).run(ec2Host);
    } catch (_) {}

    conn.shell(
      { term: "xterm-256color", cols: 120, rows: 30 },
      (err, stream) => {
        if (err) {
          console.error("SSH shell error:", err.message);
          const ws = clients.get(clientId);
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "terminal-output",
                data: `\r\nShell error: ${err.message}\r\n`,
              }),
            );
            ws.send(JSON.stringify({ type: "terminal-exit", exitCode: 1 }));
          }
          conn.end();
          return;
        }

        // Store session
        terminals.set(clientId, { conn, stream });

        // Pipe SSH output -> WebSocket
        stream.on("data", (data) => {
          const ws = clients.get(clientId);
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "terminal-output",
                data: data.toString("utf-8"),
              }),
            );
          }
        });

        stream.stderr.on("data", (data) => {
          const ws = clients.get(clientId);
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "terminal-output",
                data: data.toString("utf-8"),
              }),
            );
          }
        });

        stream.on("close", () => {
          console.log(
            `SSH stream closed: root@${ec2Host} [client: ${clientId}]`,
          );
          terminals.delete(clientId);
          conn.end();

          const ws = clients.get(clientId);
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "terminal-exit", exitCode: 0 }));
          }
        });
      },
    );
  });

  conn.on("error", (err) => {
    console.error(`SSH connection error: ${err.message} [client: ${clientId}]`);
    terminals.delete(clientId);

    // Update session inventory data on failure
    try {
      db.prepare(
        `UPDATE sessions SET last_connected = datetime('now'), connection_result = 'failed' WHERE host = ?`,
      ).run(ec2Host);
    } catch (_) {}

    const ws = clients.get(clientId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "terminal-output",
          data: `\r\nSSH Error: ${err.message}\r\n`,
        }),
      );
      ws.send(JSON.stringify({ type: "terminal-exit", exitCode: 1 }));
    }
  });

  conn.on("close", () => {
    console.log(
      `SSH connection closed: ${username || "ec2-user"}@${ec2Host} [client: ${clientId}]`,
    );
    terminals.delete(clientId);
  });

  // Build connection config — supports PEM key, password, or both
  const connectConfig = {
    host: ec2Host,
    port: 22,
    username: username || "ec2-user",
    readyTimeout: 15000,
    keepaliveInterval: 10000,
  };

  // Add PEM key if uploaded
  if (pemKeyPath && fs.existsSync(pemKeyPath)) {
    try {
      connectConfig.privateKey = fs.readFileSync(pemKeyPath);
      console.log(`Using PEM key for auth: ${path.basename(pemKeyPath)}`);
    } catch (e) {
      console.warn(`Failed to read PEM key: ${e.message}`);
    }
  }

  // Add password if provided (used as fallback or for root login)
  if (password) {
    connectConfig.password = password;
  }

  conn.connect(connectConfig);

  logAudit(
    "ssh_connect",
    `SSH connect: ${username || "ec2-user"}@${ec2Host}`,
    ec2Host,
    req,
  );
  res.json({ success: true, message: "SSH connection initiated" });
});

// Cleanup old files
function cleanupOldFiles() {
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  const now = Date.now();

  [UPLOAD_DIR, LOGS_DIR].forEach((dir) => {
    fs.readdirSync(dir).forEach((file) => {
      const filePath = path.join(dir, file);
      const stats = fs.statSync(filePath);

      if (now - stats.mtimeMs > maxAge) {
        fs.unlinkSync(filePath);
        console.log(`Cleaned up old file: ${file}`);
      }
    });
  });
}

// Run cleanup every hour
setInterval(cleanupOldFiles, 60 * 60 * 1000);

// Function to open browser
function openBrowser(url) {
  const platform = process.platform;
  let command;

  switch (platform) {
    case "darwin": // macOS
      command = `open ${url}`;
      break;
    case "win32": // Windows
      command = `start ${url}`;
      break;
    default: // Linux and others
      command = `xdg-open ${url} || sensible-browser ${url} || x-www-browser ${url} || gnome-open ${url}`;
      break;
  }

  exec(command, (error) => {
    if (error) {
      console.log(
        `\n⚠️  Could not auto-open browser. Please open manually: ${url}\n`,
      );
    }
  });
}

// Start server
server.listen(PORT, "0.0.0.0", () => {
  const url = `http://localhost:${PORT}`;

  console.log("========================================");
  console.log("  EC2 Password Setup UI Server");
  console.log("========================================");
  console.log(`Server running at http://0.0.0.0:${PORT}`);
  console.log(`✓ WebSocket server running on ws://localhost:${PORT}`);
  console.log("");
  console.log("Press Ctrl+C to stop");
  console.log("========================================");

  // Auto-open browser if requested
  if (process.env.AUTO_OPEN_BROWSER === "true") {
    console.log("\n🌐 Opening browser...\n");
    setTimeout(() => openBrowser(url), 1000); // Wait 1 second for server to be ready
  } else {
    console.log(`\n👉 Open your browser to: ${url}\n`);
  }
});

// Graceful shutdown
let shuttingDown = false;

function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`\n${signal} received — shutting down gracefully...`);

  // Close all active SSH sessions
  const sshCount = terminals.size;
  for (const [id, session] of terminals) {
    console.log(`  Closing SSH session: ${id}`);
    try {
      if (session.stream) session.stream.destroy();
    } catch (_) {}
    try {
      if (session.conn) session.conn.end();
    } catch (_) {}
  }
  terminals.clear();
  console.log(`  ${sshCount} SSH session(s) cleaned up`);

  // Close all WebSocket connections
  for (const [id, ws] of clients) {
    try {
      ws.terminate();
    } catch (_) {}
  }
  clients.clear();
  console.log("  WebSocket clients disconnected");

  // Clear auth tokens
  authTokens.clear();

  // Clear health check interval
  clearInterval(healthCheckInterval);

  // Close SQLite database
  try {
    db.close();
  } catch (_) {}
  console.log("  Database closed");

  // Clean up uploaded PEM keys
  try {
    const uploads = fs.readdirSync(UPLOAD_DIR);
    uploads.forEach((f) => {
      try {
        fs.unlinkSync(path.join(UPLOAD_DIR, f));
      } catch (_) {}
    });
    if (uploads.length)
      console.log(`  Cleaned ${uploads.length} uploaded file(s)`);
  } catch (_) {}

  // Close HTTP server
  server.close(() => {
    console.log("  Server closed");
    console.log("Shutdown complete.");
    process.exit(0);
  });

  // Force exit after 5 seconds if graceful close stalls
  setTimeout(() => {
    console.error("Forced exit — shutdown timed out");
    process.exit(1);
  }, 5000).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTSTP", () => gracefulShutdown("SIGTSTP"));

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  gracefulShutdown("uncaughtException");
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
  gracefulShutdown("unhandledRejection");
});
