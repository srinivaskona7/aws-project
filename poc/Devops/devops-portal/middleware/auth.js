// Basic auth middleware - checks session for admin login
// Credentials: admin / password  and ec2-user / password
const USERS = {
  admin: 'password',
  'ec2-user': 'password'
};

function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized. Please login first.' });
}

function loginHandler(req, res) {
  const { username, password } = req.body;
  if (USERS[username] && USERS[username] === password) {
    req.session.user = { username, role: username === 'admin' ? 'admin' : 'user' };
    return res.json({ success: true, user: req.session.user });
  }
  return res.status(401).json({ error: 'Invalid credentials' });
}

function logoutHandler(req, res) {
  req.session.destroy();
  res.json({ success: true });
}

module.exports = { requireAuth, loginHandler, logoutHandler };
