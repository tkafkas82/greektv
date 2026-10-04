# Deploying to a VM

Vercel's Hobby plan caps **Fast Origin Transfer at 10 GB/month**, and every
segment `/api/stream` relays counts against it, so a few people watching
relayed channels exhausts it. A small VM has no such meter worth worrying
about: Oracle Cloud's Always Free tier includes 10 TB/month of outbound
traffic, Hetzner 20 TB.

The app needs nothing beyond Node: `server.mjs` already serves `public/` and
the same `/api/*` handlers Vercel runs. On the VM it listens on `127.0.0.1:3000`
under systemd, and **Caddy** sits in front on 80/443 with an automatic
Let's Encrypt certificate.

```
browser ──https──> Caddy :443 ──> node server.mjs :3000 ──> stream hosts / Digea
```

| File | What it is |
| --- | --- |
| `setup.sh` | One-shot install: Node 22, Caddy, app user, systemd unit, firewall. Re-runnable. |
| `update.sh` | Pull the latest `main` and restart. |
| `greektv.service` | systemd unit (loopback only, restarts on crash, read-only filesystem). |
| `Caddyfile` | HTTPS, compression, the headers `vercel.json` sets, unbuffered relay. |

---

## 1. Push this folder to GitHub

`setup.sh` clones the repo onto the VM, so `deploy/` has to be on `main` first.

```bash
git add -A && git commit -m "Add VM deployment" && git push
```

## 2. Create the VM

### Oracle Cloud (free)

1. Sign up at **cloud.oracle.com**. A card is required for verification but
   Always Free resources are never charged. **Pick your home region carefully,
   as it can't be changed later:** Frankfurt or Milan are closest to Greece.
2. **Compute → Instances → Create instance**
   - Image: **Canonical Ubuntu 24.04**
   - Shape: **VM.Standard.A1.Flex** (Ampere, 1 OCPU / 6 GB is plenty), or
     **VM.Standard.E2.1.Micro** if A1 says "out of capacity"
   - Networking: keep "assign a public IPv4 address" on
   - SSH keys: upload your public key, or download the generated one
3. Open the ports in the cloud firewall: on the instance page click the
   **subnet → Default Security List → Add Ingress Rules**, source
   `0.0.0.0/0`, TCP, destination ports **80,443**.
   (`setup.sh` handles the second, OS-level firewall Oracle's images ship.)
4. Note the instance's **public IP**.

> Oracle may reclaim Always Free instances that sit nearly idle for 7 days.
> Upgrading the account to Pay-As-You-Go (still €0 if you stay within the free
> limits) prevents that.

### Hetzner (~€4/month, alternative)

**console.hetzner.cloud → Add Server →** location Falkenstein/Nuremberg/Helsinki,
image Ubuntu 24.04, type **CX22**, add your SSH key. No extra firewall steps.

## 3. Point a domain at it

Caddy needs a hostname to get a certificate. Free options:

- **DuckDNS:** sign in at duckdns.org, create `yourname.duckdns.org`, set its IP
  to the VM's public IP.
- **No signup:** use `<ip-with-dashes>.sslip.io`, e.g. `141-145-1-2.sslip.io`.
- **Your own domain:** an `A` record to the VM's IP.

Check it resolves before continuing: `nslookup yourname.duckdns.org`.

## 4. Run the setup

```bash
ssh ubuntu@<public-ip>      # Oracle's user is "ubuntu"; Hetzner's is "root"

curl -fsSL https://raw.githubusercontent.com/tkafkas82/greektv/main/deploy/setup.sh \
  | sudo bash -s -- yourname.duckdns.org
```

It generates `STREAM_PROXY_SECRET` into `/etc/greektv.env` on first run, so
cross-host segments relay without any further setup.

Open `https://yourname.duckdns.org`. The first load can take ~20 s while Caddy
fetches the certificate.

## 5. Retire the Vercel deployment

Once the VM serves correctly, delete the project in Vercel (or at least remove
its domain), otherwise visitors on the old URL keep consuming the quota.

---

## Day to day

```bash
sudo /opt/greektv/deploy/update.sh     # deploy the latest main
journalctl -u greektv -f               # app logs
journalctl -u caddy -f                 # HTTPS / proxy logs
systemctl status greektv caddy
vnstat -m                              # monthly traffic (apt install vnstat)
```

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Browser times out | Port 80/443 closed: Oracle security list (step 2.3) or `sudo iptables -L INPUT -n --line-numbers`. |
| Caddy logs `challenge failed` | DNS doesn't point at this IP yet, or port 80 is blocked. |
| `502` from Caddy | App not running: `journalctl -u greektv -n 50`. |
| Some channels still won't play | The upstream stream is dead; see "Playback" in the main README. Not a deployment issue. |
