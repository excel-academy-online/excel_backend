#!/usr/bin/env bash
# Second read-only check: Apache/Webuzo layout, SSH and firewall. Changes NOTHING.
# Run as root:  bash /root/vps-media/00-check2.sh   and paste the output back.

line() { printf '\n==== %s ====\n' "$1"; }
UPLOADS=/home/exceuapm/courses.excelacademyonline.com/wp-content/uploads

line "Uploads folder"
ls -ld "$UPLOADS" && du -sh "$UPLOADS" 2>/dev/null
echo "mp4 files: $(find "$UPLOADS" -type f -iname '*.mp4' | wc -l)"
echo "mp4 total: $(find "$UPLOADS" -type f -iname '*.mp4' -printf '%s\n' | awk '{s+=$1} END {printf "%.1f GB", s/1024/1024/1024}')"
ls "$UPLOADS" | head -20

line "Apache binary and modules"
for b in /usr/local/apps/apache2/bin/httpd /usr/sbin/httpd; do
  [ -x "$b" ] && { echo "$b"; "$b" -M 2>/dev/null | grep -E 'proxy_module|proxy_http_module|rewrite_module|ssl_module|headers_module'; }
done

line "Virtual host for courses.excelacademyonline.com"
grep -rln "courses.excelacademyonline.com" /usr/local/apps/apache2/etc/ 2>/dev/null | head -5
F=$(grep -rln "ServerName courses.excelacademyonline.com" /usr/local/apps/apache2/etc/ 2>/dev/null | head -1)
[ -n "$F" ] && { echo "file: $F"; grep -nE "VirtualHost|ServerName|DocumentRoot|Include|SSLCertificateFile|Proxy" "$F" | head -40; }

line "Webuzo custom include folders"
ls -la /usr/local/apps/apache2/etc/conf.d/ 2>/dev/null
ls -la /var/webuzo/users/exceuapm/ 2>/dev/null | head
find /usr/local/apps/apache2/etc /var/webuzo -maxdepth 4 -iname '*custom*' 2>/dev/null | head

line "PHP limits (uploads through WordPress)"
php -i 2>/dev/null | grep -E 'upload_max_filesize|post_max_size' | head -2

line "SSH"
grep -E '^(PermitRootLogin|PasswordAuthentication|Port|PubkeyAuthentication)' /etc/ssh/sshd_config 2>/dev/null
ls -la /root/.ssh/authorized_keys 2>/dev/null || echo "no authorized_keys for root"
lastb 2>/dev/null | awk '{print $3}' | sort | uniq -c | sort -rn | head -5

line "Firewall tools available"
systemctl is-active firewalld 2>/dev/null; systemctl is-enabled firewalld 2>/dev/null
rpm -q firewalld fail2ban epel-release 2>/dev/null
ss -ltnp | awk 'NR>1 {print $4}' | sed 's/.*://' | sort -un | tr '\n' ' '; echo

echo; echo "Done - nothing was changed. Copy everything above and send it back."
