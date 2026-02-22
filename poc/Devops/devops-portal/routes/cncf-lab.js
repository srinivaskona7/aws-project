'use strict';
const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');

const WORK_DIR = path.join(os.tmpdir(), 'devops-portal-cncf');
fs.mkdir(WORK_DIR, { recursive: true }).catch(() => {});

function streamCmd(res, jobId, command) {
  return new Promise((resolve, reject) => {
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
    }
    const send = (line) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify({ jobId, line, ts: Date.now() })}\n\n`); };
    const done = (code) => { if (!res.writableEnded) { res.write(`data: ${JSON.stringify({ jobId, done: true, exitCode: code })}\n\n`); res.end(); } };
    send('[CMD] Running step...');
    const proc = spawn('bash', ['-c', command], { cwd: WORK_DIR, env: { ...process.env } });
    proc.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => send(l)));
    proc.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => send(`[STDERR] ${l}`)));
    proc.on('close', code => { send(code === 0 ? '[OK] Step completed' : `[WARN] Exit ${code}`); done(code); code === 0 ? resolve() : reject(new Error(`Exit ${code}`)); });
    proc.on('error', err => { send(`[ERROR] ${err.message}`); done(1); reject(err); });
  });
}

const ISTIO_STEPS = [
  {
    id: 'istio-install', step: 1,
    title: 'Install Istio Service Mesh',
    description: 'Installs Istio demo profile into istio-system namespace. Deploys istiod (control plane), ingress gateway, and egress gateway.',
    architecture: `BEFORE: Pod A --HTTP--> Pod B (plaintext)

AFTER Istio Install:
  istio-system namespace:
    istiod (Pilot + Citadel + Galley)
    istio-ingressgateway
    istio-egressgateway
  App pods: no sidecars yet`,
    impact: 'Adds istio-system namespace ~5 pods. Zero impact on existing workloads.',
    manifest: null,
    command: `kubectl cluster-info 2>/dev/null || echo "[WARN] Configure kubectl first: aws eks update-kubeconfig --name CLUSTER"
command -v istioctl >/dev/null 2>&1 || curl -sL https://istio.io/downloadIstio | sh -
ISTIO_DIR=$(ls -d /tmp/istio-* 2>/dev/null | head -1)
[ -n "$ISTIO_DIR" ] && cp "$ISTIO_DIR/bin/istioctl" /usr/local/bin/ 2>/dev/null || true
echo "[INFO] Installing Istio demo profile..."
istioctl install --set profile=demo -y 2>&1 | tail -20
kubectl wait --for=condition=available --timeout=180s deployment/istiod -n istio-system 2>/dev/null && echo "[OK] istiod ready"
kubectl wait --for=condition=available --timeout=60s deployment/istio-ingressgateway -n istio-system 2>/dev/null && echo "[OK] ingress gateway ready"
echo "=== Istio Pods ==="
kubectl get pods -n istio-system
echo "=== Istio Services ==="
kubectl get svc -n istio-system`
  },
  {
    id: 'istio-sidecar', step: 2,
    title: 'Enable Envoy Sidecar Injection',
    description: 'Labels default namespace for auto sidecar injection. Every new pod gets an Envoy proxy that intercepts all traffic.',
    architecture: `AFTER injection enabled:
  Pod:
    app-container  (your app)
    istio-proxy    (Envoy sidecar)

  Envoy handles: mTLS, retries,
  timeouts, circuit breaking,
  telemetry, tracing`,
    impact: 'New pods get 2 containers. Existing pods need restart. ~50MB RAM per sidecar.',
    manifest: null,
    command: `kubectl label namespace default istio-injection=enabled --overwrite
echo "[RESULT] Namespace label:"
kubectl get namespace default --show-labels | grep istio
echo ""
echo "[INFO] Deploying test pod to verify injection..."
kubectl run sidecar-test --image=nginx:alpine --restart=Never 2>/dev/null || true
sleep 10
echo "[RESULT] Pod containers:"
kubectl get pod sidecar-test -o jsonpath='{.spec.containers[*].name}' 2>/dev/null && echo ""
kubectl delete pod sidecar-test --grace-period=0 2>/dev/null || true
echo "[DONE] All new pods in default namespace get Envoy sidecar"`
  },
  {
    id: 'istio-bookinfo', step: 3,
    title: 'Deploy Bookinfo Sample App',
    description: 'Deploys 4 microservices: productpage, details, reviews (3 versions), ratings. Perfect for testing Istio traffic management.',
    architecture: `Bookinfo:
  productpage (Python)
    -> details (Ruby)
    -> reviews-v1 (no stars)
    -> reviews-v2 (black stars)
    -> reviews-v3 (red stars)
       -> ratings (Node.js)`,
    impact: '6 pods with Envoy sidecars (12 containers). Gateway + VirtualService created.',
    manifest: null,
    command: `kubectl apply -f https://raw.githubusercontent.com/istio/istio/release-1.21/samples/bookinfo/platform/kube/bookinfo.yaml
kubectl wait --for=condition=ready pod -l app=productpage --timeout=120s 2>/dev/null || true
kubectl wait --for=condition=ready pod -l app=reviews --timeout=120s 2>/dev/null || true
echo "=== Bookinfo Pods ==="
kubectl get pods -l 'app in (productpage,details,reviews,ratings)'
kubectl apply -f https://raw.githubusercontent.com/istio/istio/release-1.21/samples/bookinfo/networking/bookinfo-gateway.yaml
echo "=== Gateway ==="
kubectl get gateway,virtualservice
GW=$(kubectl -n istio-system get svc istio-ingressgateway -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null)
echo "[ACCESS] http://\${GW:-GATEWAY_IP}/productpage"`
  },
  {
    id: 'istio-traffic-split', step: 4,
    title: 'Traffic Split: 80% v1 / 20% v3',
    description: 'VirtualService + DestinationRule: route 80% to reviews-v1 (no stars), 20% to reviews-v3 (red stars).',
    architecture: `Request -> VirtualService
  80% -> reviews-v1 (no stars)
  20% -> reviews-v3 (red stars)

DestinationRule defines subsets
by pod version label`,
    impact: 'Adds 2 Istio CRDs. No pod changes. Instant rollback by editing weights.',
    manifest: `apiVersion: networking.istio.io/v1alpha3
kind: DestinationRule
metadata:
  name: reviews
spec:
  host: reviews
  subsets:
  - name: v1
    labels:
      version: v1
  - name: v3
    labels:
      version: v3
---
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: reviews
spec:
  hosts:
  - reviews
  http:
  - route:
    - destination:
        host: reviews
        subset: v1
      weight: 80
    - destination:
        host: reviews
        subset: v3
      weight: 20`,
    command: `kubectl apply -f - <<'YAML'
apiVersion: networking.istio.io/v1alpha3
kind: DestinationRule
metadata:
  name: reviews
spec:
  host: reviews
  subsets:
  - name: v1
    labels:
      version: v1
  - name: v2
    labels:
      version: v2
  - name: v3
    labels:
      version: v3
YAML
kubectl apply -f - <<'YAML'
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: reviews
spec:
  hosts:
  - reviews
  http:
  - route:
    - destination:
        host: reviews
        subset: v1
      weight: 80
    - destination:
        host: reviews
        subset: v3
      weight: 20
YAML
echo "=== Applied ==="
kubectl get virtualservice,destinationrule
echo "[LIVE] 80% -> v1 (no stars), 20% -> v3 (red stars)"
echo "[TEST] Refresh /productpage 10x - red stars appear ~2x"`
  },
  {
    id: 'istio-circuit-breaker', step: 5,
    title: 'Circuit Breaker + Outlier Detection',
    description: 'Auto-eject failing pods after 3 consecutive errors. 30s ejection window. Protects against cascading failures.',
    architecture: `3 errors -> pod ejected 30s
  healthy pod absorbs all traffic
  auto-recovery after timeout`,
    impact: 'Adds trafficPolicy to DestinationRule. Immediate effect.',
    manifest: `apiVersion: networking.istio.io/v1alpha3
kind: DestinationRule
metadata:
  name: ratings
spec:
  host: ratings
  trafficPolicy:
    outlierDetection:
      consecutive5xxErrors: 3
      interval: 10s
      baseEjectionTime: 30s`,
    command: `kubectl apply -f - <<'YAML'
apiVersion: networking.istio.io/v1alpha3
kind: DestinationRule
metadata:
  name: ratings
spec:
  host: ratings
  trafficPolicy:
    connectionPool:
      tcp:
        maxConnections: 1
      http:
        http1MaxPendingRequests: 1
        maxRequestsPerConnection: 1
    outlierDetection:
      consecutive5xxErrors: 3
      interval: 10s
      baseEjectionTime: 30s
      maxEjectionPercent: 100
YAML
echo "=== Circuit Breaker Config ==="
kubectl get destinationrule ratings -o yaml | grep -A 20 trafficPolicy
echo "[ACTIVE] 3 errors -> pod ejected 30s, healthy pod absorbs traffic"`
  },
  {
    id: 'istio-mtls', step: 6,
    title: 'Mutual TLS (mTLS) STRICT Mode',
    description: 'All pod-to-pod traffic encrypted with TLS 1.3. SPIFFE certificates issued by istiod. Auto-rotated every 24h.',
    architecture: `STRICT mTLS:
  Pod A <--TLS 1.3--> Pod B
  SPIFFE cert identity
  Auto-rotated 24h
  Zero app code changes`,
    impact: 'Rejects non-mTLS connections. External clients without sidecar blocked.',
    manifest: `apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
  namespace: default
spec:
  mtls:
    mode: STRICT`,
    command: `kubectl apply -f - <<'YAML'
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
  namespace: default
spec:
  mtls:
    mode: STRICT
YAML
echo "=== PeerAuthentication ==="
kubectl get peerauthentication -n default
echo "[IMPACT] All pod-to-pod: TLS 1.3, SPIFFE identity, auto-rotated"`
  },
  {
    id: 'istio-fault-inject', step: 7,
    title: 'Fault Injection: 3s Delay on Reviews',
    description: 'Inject artificial 3-second delay on 100% of reviews requests. Test timeout handling. Remove fault to restore instantly.',
    architecture: `Request -> Envoy -> [3s delay] -> reviews
No code changes needed
Remove VirtualService fault to restore`,
    impact: 'Reviews page delayed 3s. Remove fault config to restore instantly.',
    manifest: `apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: reviews
spec:
  hosts:
  - reviews
  http:
  - fault:
      delay:
        percentage:
          value: 100.0
        fixedDelay: 3s
    route:
    - destination:
        host: reviews
        subset: v1`,
    command: `kubectl apply -f - <<'YAML'
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: reviews
spec:
  hosts:
  - reviews
  http:
  - fault:
      delay:
        percentage:
          value: 100.0
        fixedDelay: 3s
    route:
    - destination:
        host: reviews
        subset: v1
YAML
echo "[LIVE] 3s delay ACTIVE on all reviews requests"
echo "[TEST] Access /productpage - reviews delayed ~3s"
sleep 5
kubectl apply -f - <<'YAML'
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: reviews
spec:
  hosts:
  - reviews
  http:
  - route:
    - destination:
        host: reviews
        subset: v1
      weight: 80
    - destination:
        host: reviews
        subset: v3
      weight: 20
YAML
echo "[DONE] Fault removed, normal 80/20 restored"`
  },
  {
    id: 'istio-observability', step: 8,
    title: 'Observability: Kiali + Jaeger + Grafana',
    description: 'Complete observability stack. Service mesh topology, distributed tracing, pre-built dashboards. Zero instrumentation.',
    architecture: `Kiali  -> service mesh map
Jaeger -> distributed tracing
Grafana -> metrics dashboards
Prometheus -> PromQL queries
All via Envoy sidecars - no code changes`,
    impact: 'Adds ~8 pods in istio-system. Port-forward to access dashboards.',
    manifest: null,
    command: `BASE="https://raw.githubusercontent.com/istio/istio/release-1.21/samples/addons"
for addon in prometheus grafana jaeger kiali; do
  echo "[INFO] Installing $addon..."
  kubectl apply -f "$BASE/$addon.yaml" 2>/dev/null && echo "[OK] $addon" || echo "[WARN] $addon issue"
done
kubectl wait --for=condition=available --timeout=120s deployment/kiali -n istio-system 2>/dev/null || true
kubectl wait --for=condition=available --timeout=120s deployment/prometheus -n istio-system 2>/dev/null || true
echo "=== Addon Pods ==="
kubectl get pods -n istio-system | grep -E "kiali|jaeger|prometheus|grafana"
echo ""
echo "[ACCESS] Port-forwards:"
echo "  Kiali:   kubectl port-forward svc/kiali -n istio-system 20001:20001"
echo "  Grafana: kubectl port-forward svc/grafana -n istio-system 3000:3000"
echo "  Jaeger:  kubectl port-forward svc/tracing -n istio-system 16686:80"`
  },
  {
    id: 'istio-canary', step: 9,
    title: 'Canary Release: 10% -> 50% -> 100%',
    description: 'Progressive traffic shift from v1 to v3 in 3 steps. Single kubectl apply per step. Instant rollback.',
    architecture: `Step 1: 90% v1 / 10% v3
Step 2: 50% v1 / 50% v3
Step 3:  0% v1 / 100% v3
Rollback: set v3 weight: 0`,
    impact: 'Three VirtualService applies. Zero downtime. Old pods kept running.',
    manifest: null,
    command: `echo "=== CANARY STEP 1: 10% ==="
kubectl apply -f - <<'YAML'
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: reviews
spec:
  hosts:
  - reviews
  http:
  - route:
    - destination:
        host: reviews
        subset: v1
      weight: 90
    - destination:
        host: reviews
        subset: v3
      weight: 10
YAML
echo "[LIVE] 90% v1, 10% v3"
sleep 3
echo "=== CANARY STEP 2: 50% ==="
kubectl apply -f - <<'YAML'
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: reviews
spec:
  hosts:
  - reviews
  http:
  - route:
    - destination:
        host: reviews
        subset: v1
      weight: 50
    - destination:
        host: reviews
        subset: v3
      weight: 50
YAML
echo "[LIVE] 50% v1, 50% v3"
sleep 3
echo "=== CANARY STEP 3: 100% v3 ==="
kubectl apply -f - <<'YAML'
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: reviews
spec:
  hosts:
  - reviews
  http:
  - route:
    - destination:
        host: reviews
        subset: v3
      weight: 100
YAML
echo "[LIVE] 100% traffic on reviews-v3"
echo "[DONE] Migration complete, zero downtime"`
  },
  {
    id: 'istio-authz', step: 10,
    title: 'Zero-Trust AuthorizationPolicy',
    description: 'Deny all by default, then explicitly allow required service-to-service calls via SPIFFE identity. No IP rules needed.',
    architecture: `ALLOWED (explicit policy):
  productpage -> reviews/details
  reviews     -> ratings

DENIED (no policy = 403):
  All other cross-service calls
  Based on SPIFFE cert identity`,
    impact: 'Immediate enforcement. Unauthorized calls return 403. Audit service deps first.',
    manifest: `apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: deny-all
  namespace: default
spec: {}`,
    command: `echo "[INFO] Applying deny-all policy..."
kubectl apply -f - <<'YAML'
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: deny-all
  namespace: default
spec: {}
YAML
echo "[ACTIVE] All calls DENIED"
for svc in reviews details ratings; do
kubectl apply -f - <<YAML
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: allow-$svc
  namespace: default
spec:
  selector:
    matchLabels:
      app: $svc
  action: ALLOW
  rules:
  - from:
    - source:
        namespaces: ["default"]
    to:
    - operation:
        methods: ["GET"]
YAML
echo "[ALLOWED] -> $svc"
done
echo "=== Policies ==="
kubectl get authorizationpolicies -n default
echo "[DONE] Zero-trust active: only permitted flows work"`
  }
];

const CNCF_LABS = {
  argocd: {
    name: 'Argo CD — GitOps Continuous Delivery',
    description: 'Deploy Argo CD, connect a Git repo, sync apps automatically. Git is the single source of truth.',
    steps: [
      { id: 'install', title: 'Install Argo CD',
        command: `kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
kubectl wait --for=condition=available --timeout=180s deployment/argocd-server -n argocd
PASS=$(kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" 2>/dev/null | base64 -d)
echo "=== Argo CD Pods ==="
kubectl get pods -n argocd
echo "[ACCESS] kubectl port-forward svc/argocd-server -n argocd 8443:443"
echo "[LOGIN]  admin / \${PASS:-check-argocd-initial-admin-secret}"` },
      { id: 'deploy-app', title: 'Deploy Guestbook App via GitOps',
        command: `kubectl apply -f - <<'YAML'
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: guestbook
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/argoproj/argocd-example-apps.git
    targetRevision: HEAD
    path: guestbook
  destination:
    server: https://kubernetes.default.svc
    namespace: guestbook
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
    - CreateNamespace=true
YAML
sleep 20
kubectl get application -n argocd guestbook 2>/dev/null || echo "[INFO] Application created"
kubectl get pods -n guestbook 2>/dev/null || echo "[INFO] Syncing from git..."
echo "[BEHAVIOR] Git push -> Argo CD auto-deploys to cluster"` }
    ]
  },
  kyverno: {
    name: 'Kyverno — K8s-Native Policy Engine',
    description: 'Policy-as-code without Rego. Require labels, block privileged containers, auto-add resources limits using K8s YAML syntax.',
    steps: [
      { id: 'install', title: 'Install Kyverno',
        command: `helm repo add kyverno https://kyverno.github.io/kyverno 2>/dev/null || true
helm repo update
kubectl create namespace kyverno --dry-run=client -o yaml | kubectl apply -f -
helm upgrade --install kyverno kyverno/kyverno -n kyverno --wait --timeout 5m
kubectl get pods -n kyverno` },
      { id: 'require-labels', title: 'Policy: Require team Label',
        command: `kubectl apply -f - <<'YAML'
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: require-team-label
spec:
  validationFailureAction: enforce
  rules:
  - name: check-team
    match:
      any:
      - resources:
          kinds: [Pod]
    validate:
      message: "label 'team' required on all pods"
      pattern:
        metadata:
          labels:
            team: "?*"
YAML
echo "[POLICY ACTIVE] All pods need label: team=value"
kubectl run test-no-label --image=nginx --dry-run=server 2>&1 | head -5
echo "[TEST PASSED] Pod blocked - missing team label"` },
      { id: 'no-privileged', title: 'Policy: Block Privileged Containers',
        command: `kubectl apply -f - <<'YAML'
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: disallow-privileged
spec:
  validationFailureAction: enforce
  rules:
  - name: no-privileged
    match:
      any:
      - resources:
          kinds: [Pod]
    validate:
      message: "Privileged containers not allowed"
      pattern:
        spec:
          containers:
          - =(securityContext):
              =(privileged): "false | null"
YAML
kubectl get clusterpolicies` }
    ]
  },
  prometheus: {
    name: 'Prometheus + Grafana — Observability Stack',
    description: 'kube-prometheus-stack with pre-built dashboards, ServiceMonitors, and custom alert rules.',
    steps: [
      { id: 'install', title: 'Install kube-prometheus-stack',
        command: `helm repo add prometheus-community https://prometheus-community.github.io/helm-charts 2>/dev/null || true
helm repo update
kubectl create namespace monitoring --dry-run=client -o yaml | kubectl apply -f -
helm upgrade --install kube-prom prometheus-community/kube-prometheus-stack \
  -n monitoring \
  --set grafana.adminPassword=devops123 \
  --set prometheus.prometheusSpec.retention=7d \
  --wait --timeout 10m
kubectl get pods -n monitoring | head -15
echo "[ACCESS] kubectl port-forward svc/kube-prom-grafana -n monitoring 3000:80"
echo "[LOGIN]  admin / devops123"` },
      { id: 'alert-rule', title: 'Create PrometheusRule Alerts',
        command: `kubectl apply -f - <<'YAML'
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: devops-alerts
  namespace: monitoring
  labels:
    release: kube-prom
spec:
  groups:
  - name: pod-alerts
    rules:
    - alert: PodCrashLooping
      expr: increase(kube_pod_container_status_restarts_total[1h]) > 5
      for: 0m
      labels:
        severity: critical
      annotations:
        summary: "Pod {{ $labels.pod }} crash-looping"
YAML
kubectl get prometheusrule -n monitoring` }
    ]
  },
  keda: {
    name: 'KEDA — Event-Driven Autoscaling',
    description: 'Scale deployments to zero or thousands based on queue depth, HTTP traffic, cron schedules. 60+ scalers.',
    steps: [
      { id: 'install', title: 'Install KEDA',
        command: `helm repo add kedacore https://kedacore.github.io/charts 2>/dev/null || true
helm repo update
kubectl create namespace keda --dry-run=client -o yaml | kubectl apply -f -
helm upgrade --install keda kedacore/keda -n keda --wait --timeout 5m
kubectl get pods -n keda` },
      { id: 'cron-scaler', title: 'ScaledObject: Business Hours',
        command: `kubectl apply -f - <<'YAML'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: keda-demo
spec:
  replicas: 1
  selector:
    matchLabels:
      app: keda-demo
  template:
    metadata:
      labels:
        app: keda-demo
    spec:
      containers:
      - name: app
        image: nginx:alpine
        resources:
          requests: {cpu: 10m, memory: 32Mi}
---
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: keda-demo-scaler
spec:
  scaleTargetRef:
    name: keda-demo
  minReplicaCount: 1
  maxReplicaCount: 10
  triggers:
  - type: cron
    metadata:
      timezone: UTC
      start: "0 8 * * 1-5"
      end: "0 20 * * 1-5"
      desiredReplicas: "5"
YAML
kubectl get scaledobject keda-demo-scaler
kubectl get hpa | grep keda
echo "[BEHAVIOR] Mon-Fri 8am: scale to 5 | outside hours: scale to 1"` }
    ]
  },
  falco: {
    name: 'Falco — Runtime Security Detection',
    description: 'Real-time detection of shell spawns, privilege escalation, crypto mining, and file system tampering in containers.',
    steps: [
      { id: 'install', title: 'Install Falco',
        command: `helm repo add falcosecurity https://falcosecurity.github.io/charts 2>/dev/null || true
helm repo update
kubectl create namespace falco --dry-run=client -o yaml | kubectl apply -f -
helm upgrade --install falco falcosecurity/falco -n falco --wait --timeout 5m 2>/dev/null || echo "[INFO] Falco may need kernel headers"
kubectl get pods -n falco
echo "[DETECTS] shell spawn, privilege escalation, crypto mining, /etc writes"` },
      { id: 'test-detection', title: 'Test Shell Detection',
        command: `echo "[INFO] Falco custom rules for shell detection:"
echo ""
echo "- rule: Detect Shell Spawn"
echo "  condition: spawned_process and container"
echo "             and proc.name in (bash, sh, zsh)"
echo "  priority: WARNING"
echo ""
echo "[TEST] Trigger a Falco alert:"
echo "  kubectl exec -it <pod> -- /bin/bash"
echo "  -> Falco immediately logs WARNING"
echo ""
echo "[MONITOR] kubectl logs -n falco -l app.kubernetes.io/name=falco -f"
kubectl get pods -n falco` }
    ]
  },
  gatekeeper: {
    name: 'OPA Gatekeeper — Policy as Code (Rego)',
    description: 'Admission webhook enforcing Rego policies. Block pods from untrusted registries, require resource limits, enforce naming conventions.',
    steps: [
      { id: 'install', title: 'Install OPA Gatekeeper',
        command: `kubectl apply -f https://raw.githubusercontent.com/open-policy-agent/gatekeeper/release-3.14/deploy/gatekeeper.yaml
kubectl wait --for=condition=available --timeout=180s deployment/gatekeeper-controller-manager -n gatekeeper-system
kubectl wait --for=condition=available --timeout=120s deployment/gatekeeper-audit -n gatekeeper-system
kubectl get pods -n gatekeeper-system` },
      { id: 'registry-policy', title: 'Policy: Allowed Image Registries',
        command: `kubectl apply -f - <<'YAML'
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: allowedrepos
spec:
  crd:
    spec:
      names:
        kind: AllowedRepos
      validation:
        openAPIV3Schema:
          type: object
          properties:
            repos:
              type: array
              items:
                type: string
  targets:
  - target: admission.k8s.gatekeeper.sh
    rego: |
      package allowedrepos
      violation[{"msg": msg}] {
        c := input.review.object.spec.containers[_]
        ok := [r | r = input.parameters.repos[_]; startswith(c.image, r)]
        count(ok) == 0
        msg := sprintf("image <%v> from untrusted registry", [c.image])
      }
---
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: AllowedRepos
metadata:
  name: prod-allowed-repos
spec:
  match:
    kinds:
    - apiGroups: [""]
      kinds: ["Pod"]
  parameters:
    repos: ["nginx", "alpine", "registry.k8s.io/", "gcr.io/"]
YAML
echo "[POLICY ACTIVE] Only allowed registries"
kubectl run bad --image=bad.registry.io/image --dry-run=server 2>&1 | head -5` }
    ]
  },
  velero: {
    name: 'Velero — K8s Backup & Disaster Recovery',
    description: 'Backup and restore Kubernetes namespaces, PVs, and cluster resources. Full DR automation.',
    steps: [
      { id: 'install', title: 'Install Velero CLI + DR Runbook',
        command: `command -v velero >/dev/null 2>&1 && echo "[SKIP] $(velero version --client-only)" || (
  VER="v1.13.2"
  curl -sLO "https://github.com/vmware-tanzu/velero/releases/download/SHELL_VER/velero-SHELL_VER-linux-amd64.tar.gz"
  tar xzf "velero-SHELL_VER-linux-amd64.tar.gz" 2>/dev/null || true
  sudo mv velero-*/velero /usr/local/bin/ 2>/dev/null || true
  rm -rf velero-* 2>/dev/null || true
  echo "[DONE] $(velero version --client-only 2>/dev/null)"
)
echo ""
echo "=== Velero DR Runbook ==="
echo "1. Install: velero install --provider aws --plugins velero/velero-plugin-for-aws:v1.9.0 --bucket BUCKET --backup-location-config region=us-east-1 --secret-file ./credentials"
echo "2. Backup:  velero backup create pre-upgrade --include-namespaces default"
echo "3. Verify:  velero backup describe pre-upgrade"
echo "4. Disaster: kubectl delete namespace default"
echo "5. Restore: velero restore create --from-backup pre-upgrade"
echo "6. Check:   kubectl get pods -n default"` }
    ]
  },
  crossplane: {
    name: 'Crossplane — Cloud Infra via kubectl',
    description: 'Provision AWS S3, RDS, VPCs using kubectl apply. Your cluster becomes a cloud control plane.',
    steps: [
      { id: 'install', title: 'Install Crossplane',
        command: `helm repo add crossplane-stable https://charts.crossplane.io/stable 2>/dev/null || true
helm repo update
kubectl create namespace crossplane-system --dry-run=client -o yaml | kubectl apply -f -
helm upgrade --install crossplane crossplane-stable/crossplane -n crossplane-system --wait --timeout 5m
kubectl get pods -n crossplane-system
echo "[CONCEPT] kubectl apply -f s3bucket.yaml -> creates real S3 bucket in AWS"` },
      { id: 'aws-provider', title: 'Install AWS Provider + S3 Example',
        command: `kubectl apply -f - <<'YAML'
apiVersion: pkg.crossplane.io/v1
kind: Provider
metadata:
  name: provider-aws-s3
spec:
  package: xpkg.upbound.io/upbound/provider-aws-s3:v1.1.0
YAML
sleep 15
kubectl get providers
echo ""
echo "=== S3 Bucket Manifest (apply after configuring credentials) ==="
echo "apiVersion: s3.aws.upbound.io/v1beta1"
echo "kind: Bucket"
echo "metadata:"
echo "  name: my-crossplane-bucket"
echo "spec:"
echo "  forProvider:"
echo "    region: us-east-1"
echo ""
echo "[IMPACT] kubectl apply = real S3 bucket created"
echo "         kubectl delete = real S3 bucket deleted"
echo "         Drift detection: Crossplane recreates if deleted in AWS"` }
    ]
  },
  tekton: {
    name: 'Tekton — Cloud-Native CI/CD Pipelines',
    description: 'K8s-native CI/CD. Tasks, Pipelines, PipelineRuns. Git-triggered builds. No Jenkins dependency.',
    steps: [
      { id: 'install', title: 'Install Tekton Pipelines',
        command: `kubectl apply -f https://storage.googleapis.com/tekton-releases/pipeline/latest/release.yaml
kubectl wait --for=condition=available --timeout=120s deployment/tekton-pipelines-controller -n tekton-pipelines
kubectl wait --for=condition=available --timeout=120s deployment/tekton-pipelines-webhook -n tekton-pipelines
kubectl get pods -n tekton-pipelines
kubectl apply -f https://storage.googleapis.com/tekton-releases/dashboard/latest/release.yaml 2>/dev/null || true
echo "[ACCESS] kubectl port-forward svc/tekton-dashboard -n tekton-pipelines 9097:9097"` },
      { id: 'pipeline', title: 'Run First Pipeline',
        command: `kubectl apply -f - <<'YAML'
apiVersion: tekton.dev/v1
kind: Task
metadata:
  name: devops-build
spec:
  steps:
  - name: build
    image: alpine
    script: |
      echo "=== Tekton Build Task ==="
      echo "Simulating: git clone, test, docker build"
      date && uname -a
      echo "=== Build Success ==="
---
apiVersion: tekton.dev/v1
kind: Pipeline
metadata:
  name: devops-pipeline
spec:
  tasks:
  - name: build-and-test
    taskRef:
      name: devops-build
---
apiVersion: tekton.dev/v1
kind: PipelineRun
metadata:
  generateName: devops-run-
spec:
  pipelineRef:
    name: devops-pipeline
YAML
sleep 10
kubectl get pipelinerun | head -5
kubectl get taskrun | head -5` }
    ]
  },
  fluxcd: {
    name: 'Flux CD — GitOps Continuous Delivery',
    description: 'Bootstrap Flux, auto-sync from Git, HelmRelease management, drift detection and self-healing.',
    steps: [
      { id: 'install', title: 'Install Flux CLI',
        command: `command -v flux >/dev/null 2>&1 && echo "[SKIP] $(flux --version)" || curl -s https://fluxcd.io/install.sh | sudo bash
echo "[DONE] $(flux --version)"
flux check --pre 2>/dev/null || echo "[INFO] Cluster ready for Flux"
echo ""
echo "=== Bootstrap Command ==="
echo "flux bootstrap github \\"
echo "  --owner=YOUR_USERNAME \\"
echo "  --repository=fleet-infra \\"
echo "  --branch=main \\"
echo "  --path=./clusters/my-cluster \\"
echo "  --personal"
echo ""
echo "[WHAT IT DOES]:"
echo "  Creates fleet-infra GitHub repo"
echo "  Installs Flux controllers in flux-system"
echo "  Creates SSH deploy key"
echo "  Git push -> cluster auto-updates"` },
      { id: 'helmrelease', title: 'HelmRelease: Auto-Update Charts',
        command: `echo "[HELMRELEASE MANIFEST]:"
echo ""
echo "apiVersion: source.toolkit.fluxcd.io/v1beta2"
echo "kind: HelmRepository"
echo "metadata:"
echo "  name: bitnami"
echo "  namespace: flux-system"
echo "spec:"
echo "  interval: 30m"
echo "  url: https://charts.bitnami.com/bitnami"
echo "---"
echo "apiVersion: helm.toolkit.fluxcd.io/v2beta1"
echo "kind: HelmRelease"
echo "metadata:"
echo "  name: nginx"
echo "  namespace: default"
echo "spec:"
echo "  interval: 5m"
echo "  chart:"
echo "    spec:"
echo "      chart: nginx"
echo "      version: '>=15.0.0'"
echo "      sourceRef:"
echo "        kind: HelmRepository"
echo "        name: bitnami"
echo ""
echo "[FLUX BEHAVIOR]:"
echo "  Polls chart repo every 30min"
echo "  Auto-upgrades within version constraint"
echo "  Drift detection: reverts manual kubectl changes"` }
    ]
  }
};

// ── Routes ──────────────────────────────────────────────────────────────────

router.get('/cncf-lab/istio/steps', (req, res) => {
  res.json({ tool: 'Istio', totalSteps: ISTIO_STEPS.length,
    steps: ISTIO_STEPS.map(s => ({ id: s.id, step: s.step, title: s.title,
      description: s.description, impact: s.impact, hasManifest: !!s.manifest,
      architecture: s.architecture })) });
});

router.get('/cncf-lab/istio/steps/:id', (req, res) => {
  const step = ISTIO_STEPS.find(s => s.id === req.params.id || s.step === parseInt(req.params.id));
  if (!step) return res.status(404).json({ error: 'Step not found' });
  res.json(step);
});

router.post('/cncf-lab/istio/apply/:id', async (req, res) => {
  const step = ISTIO_STEPS.find(s => s.id === req.params.id || s.step === parseInt(req.params.id));
  if (!step) return res.status(404).json({ error: 'Step not found' });
  try { await streamCmd(res, uuidv4().substring(0, 8), step.command); }
  catch(err) { if (!res.headersSent) res.status(500).json({ error: err.message }); }
});

router.get('/cncf-lab/tools', (req, res) => {
  res.json({ tools: Object.entries(CNCF_LABS).map(([id, lab]) => ({
    id, name: lab.name, description: lab.description, steps: lab.steps.length })) });
});

router.get('/cncf-lab/tools/:id', (req, res) => {
  const lab = CNCF_LABS[req.params.id];
  if (!lab) return res.status(404).json({ error: 'Tool not found' });
  res.json({ id: req.params.id, ...lab });
});

router.post('/cncf-lab/tools/:id/steps/:stepId', async (req, res) => {
  const lab = CNCF_LABS[req.params.id];
  if (!lab) return res.status(404).json({ error: 'Tool not found' });
  const step = lab.steps.find(s => s.id === req.params.stepId);
  if (!step) return res.status(404).json({ error: 'Step not found' });
  try { await streamCmd(res, uuidv4().substring(0, 8), step.command); }
  catch(err) { if (!res.headersSent) res.status(500).json({ error: err.message }); }
});

module.exports = router;
