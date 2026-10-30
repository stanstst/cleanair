# Deploy the project to DigitalOcean Kubernetes (DOKS)

## Functional requirements
* deploy all services from 08-deploy to the existing DOKS cluster in fra1
* same workloads, namespace cleanair, env names and secrets as 08-deploy
* CronJob schedules: fetcher every day at 23:00 ("0 23 * * *"), archiver every day at 22:00 ("0 22 * * *") so the two Jobs do not run at the same time on the 1 node; the archiver schedule is changed in the shared manifest deploy/k8s/archiver.yaml, so minikube gets it too
* reuse the 08-deploy manifests, no copy of the YAML files, no Helm
* local minikube deployment from 08-deploy must keep working
* do not change the application code of fetcher, archiver and api
* do not change the Dockerfiles
* do not create extra costs: no load balancer, no extra node, no paid registry plan, no extra volumes beyond the 3 PVCs

### Cluster
* existing DOKS cluster k8s-1-37-0-do-2-fra1-1793344160927 (id 145fd87c-f614-4046-86fd-ccc223d11558), region fra1, Kubernetes 1.37.0
* existing node pool pool-yjo6nqeqv with 1 node s-1vcpu-2gb (amd64), no extra node pool
* kubectl context do-fra1-k8s-1-37-0-do-2-fra1-1793344160927
* all pods must fit on the 1 node: resource requests of the long running pods plus the fetcher and archiver Jobs running at the same time must fit in the free allocatable CPU and memory

### Images
* build the images locally on the amd64 machine for linux/amd64, the DOKS nodes are amd64, no cross-build
* push the images to DigitalOcean Container Registry (DOCR) registry cleanair, endpoint registry.digitalocean.com/cleanair, region fra1
* the registry stays on the free Starter plan (1 repository, 500 MB), so all 3 images go to the 1 repository registry.digitalocean.com/cleanair/cleanair
* tag the images with app name and git commit short sha: api-<sha>, fetcher-<sha>, archiver-<sha>, do not use latest
* keep the registry under 500 MB: after a push delete the old tags and keep only the deployed and the previous tag per app, then run the registry garbage collection
* the cluster pulls the images from DOCR with an image pull secret in namespace cleanair
* third party images (mysql, flyway, dufs, pushgateway, prometheus, grafana, kubectl) are pulled from their public registries

### Registry credentials
* docker login with doctl registry login, no registry password in .env
* the pull secret is generated with doctl registry kubernetes-manifest for namespace cleanair and used by the app pods
* the DigitalOcean API token stays in the doctl config, do not commit it

### Storage
* PVCs use the DOKS default storage class do-block-storage
* same small PVC sizes as 08-deploy (DigitalOcean volumes are 1 GB minimum)

### Access
* no load balancer and no ingress controller
* only the UI and API, grafana and fileserver are visible on the internet, as Service type NodePort on the node public IP:
* api (UI and API) = NodePort 30080 -> 8080
* grafana = NodePort 30300 -> 3000
* fileserver = NodePort 30500 -> 5000
* all other Services (mysql, prometheus, pushgateway) stay ClusterIP, access with kubectl port-forward
* a DigitalOcean cloud firewall (free) on the cluster nodes allows inbound TCP only on 30080, 30300 and 30500 from the internet, no other NodePort is open
* the firewall targets the cluster tag k8s:145fd87c-f614-4046-86fd-ccc223d11558, not a droplet id, so it also covers a replaced or resized node
* the URLs are http://<node public ip>:30080/, :30300/ and :30500/; the node public IP changes when the node is replaced, the deploy script prints the current one
* grafana: login required, no anonymous access, GRAFANA_ADMIN_PASSWORD must be set in .env and must not be admin
* fileserver: login required for read and write with ARCHIVE_USER / ARCHIVE_PASSWORD, no anonymous read on DOKS, ARCHIVE_PASSWORD must be set in .env and must not be archiver
* the archiver keeps uploading to the fileserver inside the cluster (http://fileserver:5000), not through the NodePort
* MYSQL_ROOT_PASSWORD must not be empty for the DOKS deployment
* no TLS for now (no domain), passwords are sent over plain http; add TLS when a domain is available

### Jobs
* run fetcher and archiver on demand with kubectl create job --from=cronjob/... on the DOKS context
* the backfill Job must be runnable on DOKS with the DOCR image, run-backfill.sh takes the kubectl context as an optional argument

### Deploy script
* add a script deploy/doks-deploy.sh that:
* checks doctl is installed and authenticated, the DOKS context exists and the cluster has a Ready node
* checks the required .env values (MYSQL_ROOT_PASSWORD, GRAFANA_ADMIN_PASSWORD not admin, ARCHIVE_PASSWORD not archiver)
* logs in to DOCR, builds and pushes the 3 images tagged with app name and git short sha
* creates the config, secrets and pull secret from .env
* applies the manifests for DOKS and waits for all rollouts
* creates or updates the cloud firewall for the 3 NodePorts
* removes old image tags and starts the registry garbage collection
* prints the public URLs of the UI and API, grafana and fileserver

## Prerequisites
* DigitalOcean account (done)
* doctl installed and authenticated with doctl auth init (done)
* DOCR registry cleanair in fra1 on the Starter plan (done)
* DOKS cluster with 1 node s-1vcpu-2gb running (done)
* ARCHIVE_PASSWORD added to .env

## Cost
* control plane: free
* 1 node s-1vcpu-2gb: the existing node, no extra cost
* 3 small volumes: the only added cost, a few cents / month (1 GB volumes)
* NodePorts and cloud firewall: free
* DOCR Starter: free

## Code structure
* /deploy/k8s becomes the shared kustomize base (add kustomization.yaml)
* /deploy/doks kustomize overlay for DOKS: DOCR image names and tags, pull secret, NodePort Services for api, grafana and fileserver, fileserver without anonymous read
* /deploy/lib/common.sh shared script code for config and secrets, used by local-deploy.sh and doks-deploy.sh
* /deploy/doks-deploy.sh
* add a DigitalOcean section in README.md with deploy, access, run jobs and delete commands
