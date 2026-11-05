#!/var/jb/bin/sh
# roda como root (sudo). instala o daemon nova-locale.
set -e
mkdir -p /var/jb/usr/libexec
cp /var/tmp/nova-locale.sh /var/jb/usr/libexec/nova-locale.sh
chmod 755 /var/jb/usr/libexec/nova-locale.sh
chown root:wheel /var/jb/usr/libexec/nova-locale.sh
cp /var/tmp/com.aquiles.novalocale.plist /var/jb/Library/LaunchDaemons/com.aquiles.novalocale.plist
chmod 644 /var/jb/Library/LaunchDaemons/com.aquiles.novalocale.plist
chown root:wheel /var/jb/Library/LaunchDaemons/com.aquiles.novalocale.plist
/var/jb/bin/launchctl bootout system /var/jb/Library/LaunchDaemons/com.aquiles.novalocale.plist 2>/dev/null || true
/var/jb/bin/launchctl bootstrap system /var/jb/Library/LaunchDaemons/com.aquiles.novalocale.plist
sleep 3
echo "--- status ---"
cat /var/tmp/nova-locale-status.json 2>/dev/null || echo "sem status (veja /var/tmp/nova-locale.err)"
/var/jb/bin/launchctl print system/com.aquiles.novalocale 2>/dev/null | sed -n '1,6p'
