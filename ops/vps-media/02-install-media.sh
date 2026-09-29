#!/usr/bin/env bash
# Installs the Excel Academy media service (list / upload / delete lesson
# videos from the admin dashboard).
#
#   bash 02-install-media.sh           dry run - shows every step, changes nothing
#   bash 02-install-media.sh --apply   installs it
#
# What it sets up:
#  - Node.js 20 from AlmaLinux's own repository
#  - a system user "media" with no login shell, allowed (via ACL) to read and
#    write ONLY the uploads folder, plus its own trash folder
#  - /opt/excel-media/media-server.js run by systemd as that user, listening
#    on 127.0.0.1:8787 only, with systemd sandboxing
#  - Apache (Webuzo) forwards https://courses.excelacademyonline.com/media-api/
#    to it, through Webuzo's per-domain custom include (Webuzo's own files are
#    not touched, so its nightly rewrite keeps this)
set -euo pipefail

MODE="${1:-dry}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SITE=/home/exceuapm/courses.excelacademyonline.com
UPLOADS="$SITE/wp-content/uploads"
TRASH=/home/media-trash
APP=/opt/excel-media
PORT=8787
APACHE=/usr/local/apps/apache2/bin/apachectl
INCLUDE=/var/webuzo-data/apache2/custom/domains/courses.excelacademyonline.com.conf
MARK_BEGIN="# >>> excel-media (managed by 02-install-media.sh)"
MARK_END="# <<< excel-media"

say() { printf '%s\n' "$*"; }
run() { if [ "$MODE" = "--apply" ]; then say "+ $*"; eval "$@"; else say "[dry run] $*"; fi; }

[ -f "$HERE/media-server.js" ] || { say "media-server.js must sit next to this script"; exit 1; }
[ -d "$UPLOADS" ] || { say "Uploads folder not found: $UPLOADS"; exit 1; }
[ -x "$APACHE" ] || APACHE=apachectl

say "== 1. Node.js 20 =="
if command -v node >/dev/null && node -v | grep -q '^v2[0-9]'; then
  say "already installed: $(node -v)"
else
  run "dnf module reset -y nodejs >/dev/null"
  run "dnf module enable -y nodejs:20 >/dev/null"
  run "dnf install -y nodejs >/dev/null"
fi
run "dnf install -y acl >/dev/null"

say ""
say "== 2. Restricted user 'media' =="
if id media >/dev/null 2>&1; then say "user media exists"; else
  run "useradd --system --shell /sbin/nologin --home-dir $TRASH --no-create-home media"
fi
run "mkdir -p $TRASH/.incoming && chown -R media:media $TRASH && chmod 750 $TRASH"

say ""
say "== 3. Let 'media' manage ONLY the uploads folder (ACL; ownership unchanged) =="
# Just enough to walk down to the uploads folder. Skip folders everyone can
# already pass through - some are locked with chattr +i since the WordPress
# cleanup (on purpose), and setfacl can't change those.
for d in /home/exceuapm "$SITE" "$SITE/wp-content"; do
  if [ "$(stat -c %A "$d" | cut -c10)" = "x" ]; then
    say "ok: $d is already passable ($(stat -c %A "$d"))"
  elif lsattr -d "$d" 2>/dev/null | cut -c1-20 | grep -q i; then
    say "NOTE: $d is locked (chattr +i) and not passable - run: chattr -i '$d' && chmod o+x '$d' && chattr +i '$d'"
    [ "$MODE" = "--apply" ] && exit 1
  else
    run "setfacl -m u:media:--x '$d'"
  fi
done
# Read/write inside uploads, and the same for anything created later:
run "setfacl -R -m u:media:rwX '$UPLOADS' 2>&1 | head -5 || true"
run "setfacl -R -d -m u:media:rwX '$UPLOADS' 2>&1 | head -5 || true"
run "mkdir -p '$UPLOADS/lessons' && chown exceuapm:exceuapm '$UPLOADS/lessons' && setfacl -m u:media:rwx -m d:u:media:rwx '$UPLOADS/lessons'"
if [ "$MODE" = "--apply" ]; then
  if sudo -u media test -w "$UPLOADS/lessons" && sudo -u media test -r "$UPLOADS"; then
    say "ok: media can read uploads and write uploads/lessons"
  else
    say "PROBLEM: media still can't reach the uploads folder - send me: ls -ld /home/exceuapm $SITE $SITE/wp-content $UPLOADS; lsattr -d $SITE/wp-content $UPLOADS"
    exit 1
  fi
fi

say ""
say "== 4. Install the service =="
run "mkdir -p $APP && install -m 644 -o root -g root '$HERE/media-server.js' $APP/media-server.js"
UNIT=/etc/systemd/system/excel-media.service
if [ "$MODE" = "--apply" ]; then
  cat > "$UNIT" <<EOF
[Unit]
Description=Excel Academy media service (lesson videos)
After=network-online.target

[Service]
User=media
Group=media
Environment=PORT=$PORT
Environment=UPLOADS=$UPLOADS
Environment=TRASH=$TRASH
Environment=TMP_DIR=$TRASH/.incoming
Environment=PUBLIC_BASE=https://courses.excelacademyonline.com/wp-content/uploads
ExecStart=/usr/bin/node $APP/media-server.js
Restart=always
RestartSec=3
# Sandbox: read-only system, writes only to the uploads and trash folders.
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$UPLOADS $TRASH
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
MemoryMax=512M

[Install]
WantedBy=multi-user.target
EOF
  say "+ wrote $UNIT"
else
  say "[dry run] write $UNIT (User=media, 127.0.0.1:$PORT, sandboxed, writes only to uploads + trash)"
fi
run "systemctl daemon-reload"
run "systemctl enable --now excel-media"
run "sleep 2 && curl -fsS http://127.0.0.1:$PORT/media-api/health"

say ""
say "== 5. Apache: forward /media-api/ to the service =="
BLOCK="$MARK_BEGIN
ProxyPreserveHost On
ProxyPass /media-api/ http://127.0.0.1:$PORT/media-api/ timeout=600
ProxyPassReverse /media-api/ http://127.0.0.1:$PORT/media-api/
<Location /media-api/>
    # 16 MB upload chunks + headroom
    LimitRequestBody 20971520
</Location>
$MARK_END"
if [ "$MODE" = "--apply" ]; then
  mkdir -p "$(dirname "$INCLUDE")"
  touch "$INCLUDE"
  cp "$INCLUDE" "$INCLUDE.bak-$(date +%s)"
  # Replace any earlier copy of our block, keep everything else.
  awk -v b="$MARK_BEGIN" -v e="$MARK_END" '$0==b{skip=1} !skip{print} $0==e{skip=0}' "$INCLUDE" > "$INCLUDE.tmp"
  printf '%s\n' "$BLOCK" >> "$INCLUDE.tmp"
  mv "$INCLUDE.tmp" "$INCLUDE"
  say "+ updated $INCLUDE (backup kept next to it)"
  if "$APACHE" -t 2>&1 | grep -q "Syntax OK"; then
    "$APACHE" -k graceful
    say "+ Apache reloaded"
  else
    say "Apache config test FAILED - restoring the previous file"
    cp "$(ls -t "$INCLUDE".bak-* | head -1)" "$INCLUDE"
    "$APACHE" -t
    exit 1
  fi
  sleep 2
  say ""
  say "Check through the website:"
  curl -fsS https://courses.excelacademyonline.com/media-api/health && say "  <- OK"
  say "Service log:  journalctl -u excel-media -n 30"
else
  say "[dry run] append to $INCLUDE:"
  printf '%s\n' "$BLOCK" | sed 's/^/    /'
  say "[dry run] $APACHE -t && $APACHE -k graceful (reverts the file if the test fails)"
  say ""
  say "Dry run only - nothing changed. Run again with --apply when ready."
fi
