#!/usr/bin/env bash
# Turns on the firewall and blocks password-guessing bots (fail2ban).
#
#   bash 01-secure.sh            dry run - shows what would change, changes nothing
#   bash 01-secure.sh --apply    applies it, with a 5-minute safety net
#   bash 01-secure.sh --confirm  keep it (run within 5 minutes, from a NEW ssh login)
#
# Safety net: after --apply the firewall switches itself OFF again after 5
# minutes unless you confirm. If you ever get locked out, wait 5 minutes.
#
# Kept open: SSH 22, web 80/443, mail (25 465 587 110 995 143 993), DNS 53,
# Webuzo panels 2002-2006. Closed to the internet: MySQL 3306 (the WordPress
# database - the site reaches it locally), 953 (DNS control), FTP 21 unless
# you pass --keep-ftp.
set -euo pipefail

MODE="${1:-dry}"
KEEP_FTP=0
for a in "$@"; do [ "$a" = "--keep-ftp" ] && KEEP_FTP=1; done
TCP_PORTS="22 80 443 25 465 587 110 995 143 993 53 2002 2003 2004 2005 2006"
UDP_PORTS="53"
[ "$KEEP_FTP" = 1 ] && TCP_PORTS="$TCP_PORTS 21"

say() { printf '%s\n' "$*"; }
run() { if [ "$MODE" = "--apply" ]; then say "+ $*"; eval "$@"; else say "[dry run] $*"; fi; }

if [ "$MODE" = "--confirm" ]; then
  systemctl stop firewall-safety.timer 2>/dev/null || true
  systemctl reset-failed firewall-safety.timer firewall-safety.service 2>/dev/null || true
  say "Confirmed - the firewall stays on. Status:"
  firewall-cmd --list-all
  fail2ban-client status sshd 2>/dev/null || true
  exit 0
fi

say "== Firewall (firewalld) =="
say "Open TCP: $TCP_PORTS"
say "Open UDP: $UDP_PORTS"
say "Everything else, including MySQL 3306, is closed from outside."
run "systemctl enable --now firewalld"
for p in $TCP_PORTS; do run "firewall-cmd --permanent --add-port=${p}/tcp >/dev/null"; done
for p in $UDP_PORTS; do run "firewall-cmd --permanent --add-port=${p}/udp >/dev/null"; done
run "firewall-cmd --permanent --remove-service=cockpit >/dev/null 2>&1 || true"
run "firewall-cmd --reload >/dev/null"

say ""
say "== Safety net: firewall turns itself off in 5 minutes unless confirmed =="
run "systemd-run --unit=firewall-safety --on-active=300 /usr/bin/systemctl stop firewalld >/dev/null"

say ""
say "== fail2ban: ban an address for 1 hour after 5 wrong SSH passwords in 10 minutes =="
run "dnf install -y fail2ban fail2ban-firewalld >/dev/null"
if [ "$MODE" = "--apply" ]; then
  cat > /etc/fail2ban/jail.d/excel-sshd.local <<'EOF'
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5
# Repeat offenders: each ban is longer, up to a week.
bantime.increment = true
bantime.maxtime   = 1w
banaction = firewallcmd-rich-rules

[sshd]
enabled = true
port    = 22
EOF
  say "+ wrote /etc/fail2ban/jail.d/excel-sshd.local"
else
  say "[dry run] write /etc/fail2ban/jail.d/excel-sshd.local (sshd jail: 5 tries / 10 min -> 1h ban, growing to 1 week)"
fi
run "systemctl enable --now fail2ban"

say ""
if [ "$MODE" = "--apply" ]; then
  say "DONE. Now, within 5 minutes:"
  say "  1. Open a NEW PowerShell window and log in again:  ssh root@209.74.80.220"
  say "  2. If that works, run:  bash /root/vps-media/01-secure.sh --confirm"
  say "  3. Check the sites still open: https://courses.excelacademyonline.com and Webuzo."
  say "If you can't log in, just wait 5 minutes - the firewall switches itself off."
else
  say "Dry run only - nothing changed. Run again with --apply when ready."
fi
