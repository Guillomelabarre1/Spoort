#!/bin/sh
# Génère les icônes de l'app à partir de icons/source.webp (macOS : utilise `sips`).
#   sh scripts/make-icons.sh
# Recadrages carrés (offset y x / taille), à ajuster si tu changes de photo :
#   main  : tête + buste      → icône iOS, Android, aperçu de partage
#   face  : visage seul        → favicon de l'onglet (lisible en 32 px)
#   mask  : plus large         → icône « maskable » Android (le centre doit tenir dans 80 %)
set -e
cd "$(dirname "$0")/../icons"
crop() { # $1 sortie, $2 offsetY, $3 offsetX, $4 côté, $5 taille finale
  sips -s format png source.webp --out /tmp/rc-icon.png >/dev/null
  sips --cropOffset "$2" "$3" -c "$4" "$4" /tmp/rc-icon.png --out /tmp/rc-icon.png >/dev/null
  sips -z "$5" "$5" /tmp/rc-icon.png --out "$1" >/dev/null
}
crop icon-180.png      330 245 800 180
crop icon-192.png      330 245 800 192
crop icon-512.png      330 245 800 512
crop icon-maskable.png 230  87 1000 512
crop favicon-64.png    345 445 420 64
crop favicon-32.png    345 445 420 32
rm -f /tmp/rc-icon.png
echo "icônes générées"
