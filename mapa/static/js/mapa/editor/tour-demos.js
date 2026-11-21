const cursor = `
    <g class="td-cursor">
        <path d="M0 0 L0 15 L4 11.5 L7 18 L10 16.8 L7.2 10.5 L12 10.5 Z"
              fill="#111" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/>
    </g>`;

const streets = `<path d="M0 40H320M0 100H320M60 0V170M200 0V170" stroke="#e4dccb" stroke-width="6"/>`;

const svg = (body) => `
    <svg viewBox="0 0 320 170" focusable="false">
        <rect width="320" height="170" fill="#EEE8DC"/>
        ${streets}
        ${body}
    </svg>`;

// legendas: cada uma é visível numa janela do loop (nomes dos keyframes no CSS)
const caps = (names, texts) => `
    <div class="td-caps">
        ${texts.map((t, i) => `<span style="animation-name:${names[i]}">${t}</span>`).join("")}
    </div>`;

/* ---------- Construção: marca os cantos e fecha no 1º ponto ---------- */
const construction = {
    dur: "9s",
    html: svg(`
        <polygon class="td-poly td-k-e" points="90,115 90,50 230,50 230,115"/>
        <line class="td-line td-k-b" x1="90"  y1="115" x2="90"  y2="50"/>
        <line class="td-line td-k-c" x1="90"  y1="50"  x2="230" y2="50"/>
        <line class="td-line td-k-d" x1="230" y1="50"  x2="230" y2="115"/>
        <line class="td-line td-k-e" x1="230" y1="115" x2="90"  y2="115"/>
        <circle class="td-dot td-k-a" cx="90"  cy="115" r="6"/>
        <circle class="td-dot td-k-b" cx="90"  cy="50"  r="6"/>
        <circle class="td-dot td-k-c" cx="230" cy="50"  r="6"/>
        <circle class="td-dot td-k-d" cx="230" cy="115" r="6"/>
        <circle class="td-ring td-k-ring" cx="90" cy="115" r="12"/>
        ${cursor.replace('class="td-cursor"', 'class="td-cursor td-k-cur"')}
    `) + caps(["td-wa", "td-wb"], [
        "Clique em cada canto, em ordem",
        "Clique no 1º ponto (ou Enter) para fechar",
    ]),
};

/* ---------- Banner: abre, escolhe a categoria, preenche, o pino aparece ---------- */
const banner = {
    dur: "10s",
    html: svg(`
        <circle cx="80" cy="110" r="9" fill="#4cc36a" stroke="#1a7f37" stroke-width="3"/>
        <circle class="bd-ripple" cx="80" cy="110" r="9"/>
        <g transform="translate(80 104)">
            <g class="bd-pin">
                <path d="M0 0 L-7 -13 A8.5 8.5 0 1 1 7 -13 Z" fill="#ce2fff"/>
                <circle cy="-18" r="4.2" fill="#fff"/>
            </g>
        </g>

        <g class="bd-panel">
            <rect x="176" y="8" width="138" height="154" rx="8" fill="#fff" stroke="#d1d5db"/>
            <circle cx="194" cy="26" r="6" fill="#7ddd3d"/>
            <circle cx="212" cy="26" r="6" fill="#e8730c"/>
            <circle cx="230" cy="26" r="6" fill="#3d6fe0"/>
            <circle cx="248" cy="26" r="6" fill="#e0489a"/>
            <circle cx="266" cy="26" r="6" fill="#7c4ddb"/>
            <circle class="bd-sel" cx="0" cy="26" r="10"/>
            <rect x="186" y="42" width="118" height="32" rx="5" fill="#e5e7eb"/>
            <rect class="bd-title" x="186" y="84" width="100" height="8" rx="4"/>
            <rect class="bd-d1" x="186" y="101" width="118" height="5" rx="2.5"/>
            <rect class="bd-d2" x="186" y="112" width="108" height="5" rx="2.5"/>
            <rect class="bd-d3" x="186" y="123" width="70"  height="5" rx="2.5"/>
        </g>
        ${cursor.replace('class="td-cursor"', 'class="td-cursor bd-cur"')}
    `) + caps(["td-q1", "td-q2", "td-q3", "td-q4"], [
        "Clique na referência ou construção",
        "No painel, escolha a categoria",
        "Preencha o que for pedido",
        "O pino aparece no mapa",
    ]),
};

/* ---------- Conexões: arrasta de ponto em ponto, encadeando ---------- */
const connection = {
    dur: "7s",
    html: svg(`
        <line class="cn-line cn-l1" pathLength="1" x1="60"  y1="110" x2="140" y2="50"/>
        <line class="cn-line cn-l2" pathLength="1" x1="140" y1="50"  x2="250" y2="100"/>
        <circle class="cn-dot" cx="60"  cy="110" r="8"/>
        <circle class="cn-dot" cx="140" cy="50"  r="8"/>
        <circle class="cn-dot" cx="250" cy="100" r="8"/>
        ${cursor.replace('class="td-cursor"', 'class="td-cursor cn-cur"')}
    `) + caps(["td-h1", "td-h2"], [
        "Arraste de uma referência até outra",
        "Siga arrastando para encadear",
    ]),
};

/* ---------- Referência: arrasta até a parede e vira entrada ---------- */
const reference = {
    dur: "6s",
    html: svg(`
        <rect x="110" y="35" width="120" height="65" rx="3" fill="#fcd5a8" fill-opacity=".7" stroke="#e8730c" stroke-width="5"/>
        <g class="rf-move"><circle class="rf-dot" r="9"/></g>
        <text class="rf-label" x="170" y="124" text-anchor="middle">Entrada</text>
        <g class="rf-move">${cursor}</g>
    `) + caps(["td-h1", "td-h2"], [
        "Arraste a referência até a parede",
        "Ela gruda e vira uma entrada",
    ]),
};

export const DEMOS = { construction, banner, connection, reference };