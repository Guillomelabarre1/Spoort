// Silhouette de face et de dos, avec une zone cliquable par muscle (dessin propre à l'app).
// Chaque zone porte data-muscle ; l'appelant colore selon le volume et gère l'infobulle.

const SILHOUETTE = `
  <circle cx="50" cy="15" r="10"/>
  <rect x="45" y="23" width="10" height="8" rx="3"/>
  <path d="M28 34 Q50 28 72 34 L70 96 Q50 104 30 96 Z"/>
  <path d="M28 36 Q18 40 18 56 L14 104 Q16 108 21 106 L27 62 Z"/>
  <path d="M72 36 Q82 40 82 56 L86 104 Q84 108 79 106 L73 62 Z"/>
  <path d="M31 94 Q50 102 69 94 L67 150 L60 192 L54 192 L52 150 L50 108 L48 150 L46 192 L40 192 L33 150 Z"/>`;

const FRONT = `
  <path data-muscle="traps" d="M42 30 Q50 33 58 30 L62 35 Q50 33 38 35 Z"/>
  <ellipse data-muscle="shoulders" cx="29" cy="41" rx="8" ry="7"/>
  <ellipse data-muscle="shoulders" cx="71" cy="41" rx="8" ry="7"/>
  <path data-muscle="pecs" d="M36 38 Q44 36 49 39 L49 54 Q42 58 35 53 Q33 45 36 38 Z"/>
  <path data-muscle="pecs" d="M64 38 Q56 36 51 39 L51 54 Q58 58 65 53 Q67 45 64 38 Z"/>
  <ellipse data-muscle="biceps" cx="24" cy="60" rx="5" ry="10"/>
  <ellipse data-muscle="biceps" cx="76" cy="60" rx="5" ry="10"/>
  <ellipse data-muscle="forearms" cx="19" cy="85" rx="4.5" ry="12"/>
  <ellipse data-muscle="forearms" cx="81" cy="85" rx="4.5" ry="12"/>
  <rect data-muscle="abs" x="42.5" y="58" width="15" height="34" rx="5"/>
  <path data-muscle="obliques" d="M34 60 L41 60 L41 90 L33 86 Z"/>
  <path data-muscle="obliques" d="M66 60 L59 60 L59 90 L67 86 Z"/>
  <path data-muscle="quads" d="M34 104 Q41 100 48 106 L46 146 Q40 150 36 144 Z"/>
  <path data-muscle="quads" d="M66 104 Q59 100 52 106 L54 146 Q60 150 64 144 Z"/>
  <ellipse data-muscle="calves" cx="42" cy="168" rx="4" ry="14"/>
  <ellipse data-muscle="calves" cx="58" cy="168" rx="4" ry="14"/>`;

const BACK = `
  <path data-muscle="traps" d="M50 26 L62 34 L56 52 L50 56 L44 52 L38 34 Z"/>
  <ellipse data-muscle="shoulders" cx="29" cy="41" rx="8" ry="7"/>
  <ellipse data-muscle="shoulders" cx="71" cy="41" rx="8" ry="7"/>
  <path data-muscle="back" d="M36 44 L45 54 L48 76 L38 78 Q33 60 36 44 Z"/>
  <path data-muscle="back" d="M64 44 L55 54 L52 76 L62 78 Q67 60 64 44 Z"/>
  <ellipse data-muscle="triceps" cx="24" cy="60" rx="5" ry="10"/>
  <ellipse data-muscle="triceps" cx="76" cy="60" rx="5" ry="10"/>
  <ellipse data-muscle="forearms" cx="19" cy="85" rx="4.5" ry="12"/>
  <ellipse data-muscle="forearms" cx="81" cy="85" rx="4.5" ry="12"/>
  <rect data-muscle="lowerback" x="42" y="78" width="16" height="15" rx="4"/>
  <ellipse data-muscle="glutes" cx="42" cy="106" rx="8.5" ry="8"/>
  <ellipse data-muscle="glutes" cx="58" cy="106" rx="8.5" ry="8"/>
  <path data-muscle="hamstrings" d="M35 116 L48 116 L46 148 Q40 151 36 146 Z"/>
  <path data-muscle="hamstrings" d="M65 116 L52 116 L54 148 Q60 151 64 146 Z"/>
  <ellipse data-muscle="calves" cx="42" cy="166" rx="5" ry="13"/>
  <ellipse data-muscle="calves" cx="58" cy="166" rx="5" ry="13"/>`;

/** Deux silhouettes côte à côte (face, dos), en SVG. */
export function muscleMapSVG() {
  const view = (label, parts, x) => `
    <g transform="translate(${x} 0)">
      <g class="mm-body">${SILHOUETTE}</g>
      <g class="mm-muscles">${parts}</g>
      <text x="50" y="206" text-anchor="middle" class="mm-label">${label}</text>
    </g>`;
  return `<svg viewBox="0 0 220 212" class="muscle-map" role="img" aria-label="Carte des muscles travaillés">
    ${view('Face', FRONT, 0)}${view('Dos', BACK, 120)}
  </svg>`;
}
