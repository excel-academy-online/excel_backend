#!/usr/bin/env bash
# Read-only check before installing the media service. Changes NOTHING.
# Run as root on the VPS:  bash 00-check.sh   and paste the output back.

UPLOADS="${UPLOADS:-/home/exceuapm/public_html/courses/wp-content/uploads}"

line() { printf '\n==== %s ====\n' "$1"; }

line "System"
cat /etc/os-release 2>/dev/null | grep -E '^(NAME|VERSION)='
uname -r
uptime

line "Disk"
df -h / /home 2>/dev/null
[ -d "$UPLOADS" ] || UPLOADS=$(find /home -maxdepth 6 -type d -path '*courses/wp-content/uploads' 2>/dev/null | head -1)
echo "uploads folder: ${UPLOADS:-NOT FOUND}"
if [ -n "$UPLOADS" ]; then
  du -sh "$UPLOADS" 2>/dev/null
  echo "mp4 files: $(find "$UPLOADS" -type f -iname '*.mp4' 2>/dev/null | wc -l)"
  echo "mp4 total: $(find "$UPLOADS" -type f -iname '*.mp4' -printf '%s\n' 2>/dev/null | awk '{s+=$1} END {printf "%.1f GB", s/1024/1024/1024}')"
  echo "owner: $(stat -c '%U:%G %a' "$UPLOADS")"
  ls -ld "$UPLOADS"/lessons 2>/dev/null || echo "lessons/ folder: not created yet"
fi

line "Biggest other folders under /home and /root (backups filled the disk before)"
du -xh --max-depth=2 /home /root 2>/dev/null | sort -rh | head -12

line "Node.js / npm"
command -v node && node -v || echo "node: not installed"
command -v npm && npm -v || echo "npm: not installed"
dnf module list nodejs 2>/dev/null | grep -E 'nodejs +(18|20|22)' | head -5

line "Web server"
command -v httpd && httpd -v 2>/dev/null | head -1
command -v apachectl && apachectl -M 2>/dev/null | grep -E 'proxy_module|proxy_http|rewrite_module|ssl_module'
command -v nginx && nginx -v 2>&1
ss -ltnp 2>/dev/null | grep -E ':(80|443|8787) ' | head
ls /usr/local/apps/apache2/etc/conf.d 2>/dev/null | head   # Webuzo's Apache
ls /usr/local/webuzo 2>/dev/null >/dev/null && echo "Webuzo: present"

line "Firewall"
firewall-cmd --state 2>/dev/null && firewall-cmd --list-ports 2>/dev/null
command -v csf >/dev/null && echo "CSF firewall present"

line "Users"
id media 2>/dev/null || echo "user 'media': does not exist yet (the installer creates it)"
id exceuapm 2>/dev/null

line "Reinfection check (from the WordPress cleanup)"
crontab -l -u exceuapm 2>/dev/null | grep -v '^#' | head -5 || echo "no crontab for exceuapm"
ps -u exceuapm -o pid,etime,cmd 2>/dev/null | grep -i php | grep -v grep | head -5 || true

echo; echo "Done - nothing was changed. Copy everything above and send it back."
