# Deploy the project to Kubernetes

## Functional requirements
* create plain Kubernetes YAML manifests for all production services, applied with kubectl apply, no Helm
* follow the Production Deployment Guidelines table in README.md for the workload type of each service
* do not deploy dummy-dev-populator, it is for local dev only
* do not change the application code of fetcher, archiver and api

### Local deployment with kubectl
* the manifests must be deployable to a local minikube cluster and managed with kubectl
* build the app images (api, fetcher, archiver) locally and load them into minikube with minikube image load, no external registry
* use imagePullPolicy IfNotPresent for the locally built images
* deploy everything in a separate namespace cleanair
* small PVC sizes and low resource requests set directly in the manifests
* local secrets created from the .env file, do not commit secrets
* access the services from the host with kubectl port-forward: api 8080, grafana 3000, prometheus 9090, fileserver 5000
* run fetcher and archiver on demand with kubectl create job --from=cronjob/...
* run fetcher-backfill on demand as a Job
* verify with kubectl get pods -n cleanair all pods are Running or Completed
* add a script deploy/local-deploy.sh that starts minikube, builds and loads images, creates secrets and applies the manifests

### Workloads
* api = Deployment + Service, port 8080, exposes UI, /cleanest-city and /metrics
* fetcher = CronJob, entry point src/job.js, runs every day at 23:00 (schedule "0 23 * * *")
* fetcher-backfill = Job, entry point src/job-backfill.js, run on demand
* archiver = CronJob, entry point src/job.js, optional --months param (36 is default), runs every day at 23:00 (schedule "0 23 * * *")
* migrate (flyway) = Job applied first, uses mysql/migrations; api, fetcher and archiver wait for it with an initContainer
* mysql = StatefulSet + PVC + headless Service
* fileserver (dufs) = StatefulSet (1 replica) + PVC
* pushgateway = Deployment (1 replica) + Service
* prometheus = StatefulSet + PVC, scrapes api /metrics and pushgateway
* grafana = Deployment (1 replica), provisioned with grafana/provisioning dashboards

### Configuration
* keep the same env variable names as in docker-compose.yml
* secrets in Kubernetes Secret: OPENAQ_API_KEY, MYSQL_ROOT_PASSWORD, MYSQL_PASSWORD, ARCHIVE_PASSWORD, Grafana admin password
* non secret values in ConfigMap: DB_HOST, DB_PORT, DB_NAME, DB_USER, PUSHGATEWAY_URL, ARCHIVE_URL, ARCHIVE_USER, PORT
* image tags for app services set in the manifests
* pin the same third party image versions as in docker-compose.yml

## Code structure
* directory /deploy from the project root dir
* /deploy/k8s one YAML file per service, plus namespace.yaml and configmap.yaml
* /deploy/local-deploy.sh
* /deploy/jobs/fetcher-backfill.yaml and /deploy/run-backfill.sh to run the backfill Job with a date range
* add a Deployment section in README.md with apply / delete / run backfill commands
