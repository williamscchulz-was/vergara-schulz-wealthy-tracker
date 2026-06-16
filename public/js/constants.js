// Constantes de dados (ícones, categorias, fontes de renda, meses) — extraídas de app.js.
function _svg(paths) {
  return `<svg class="icn" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}
const ICONS = {
  home:         _svg('<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>'),
  utensils:     _svg('<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2z"/><path d="M18 15v7"/>'),
  car:          _svg('<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9L17 9.1V5.9a1 1 0 0 0-1-.9h-9a1 1 0 0 0-1 .9l-3.5 6.1C2.7 11.3 2 12.1 2 13v3c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>'),
  heartPulse:   _svg('<path d="M20.42 4.58a5.4 5.4 0 0 0-7.65 0L12 5.35l-.77-.77a5.4 5.4 0 0 0-7.65 7.65l.77.77L12 20.65l7.65-7.65.77-.77a5.4 5.4 0 0 0 0-7.65z"/><path d="M3.5 12h3l2.5-4 3 7 2-3.5h6.5"/>'),
  gamepad:      _svg('<line x1="6" y1="12" x2="10" y2="12"/><line x1="8" y1="10" x2="8" y2="14"/><circle cx="15" cy="13" r="1" fill="currentColor"/><circle cx="18" cy="11" r="1" fill="currentColor"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258l-.017-.151A4 4 0 0 0 17.32 5z"/>'),
  book:         _svg('<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>'),
  repeat:       _svg('<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>'),
  creditCard:   _svg('<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>'),
  shoppingBag:  _svg('<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>'),
  package:      _svg('<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>'),
  briefcase:    _svg('<rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>'),
  wrench:       _svg('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'),
  pieChart:     _svg('<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>'),
  trendingUp:   _svg('<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>'),
  tag:          _svg('<path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7.5" cy="7.5" r="1" fill="currentColor"/>'),
  gift:         _svg('<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C9 3 10.5 4.5 12 8"/><path d="M16.5 8a2.5 2.5 0 0 0 0-5C15 3 13.5 4.5 12 8"/>'),
  cart:         _svg('<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>'),
  plane:        _svg('<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 4.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>'),
  // Status / utility icons used outside the category lists
  check:        _svg('<polyline points="20 6 9 17 4 12"/>'),
  alertTri:     _svg('<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
  heart:        _svg('<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>'),
};

const CATEGORIES = {
  moradia:     { label: 'Moradia',           icon: ICONS.home,        color: '#0071e3' },
  alimentacao: { label: 'Alimentação',       icon: ICONS.utensils,    color: '#30d158' },
  mercado:     { label: 'Mercado',           icon: ICONS.cart,        color: '#00c7be' },
  transporte:  { label: 'Transporte',        icon: ICONS.car,         color: '#ff9500' },
  saude:       { label: 'Saúde',             icon: ICONS.heartPulse,  color: '#ff375f' },
  lazer:       { label: 'Lazer',             icon: ICONS.gamepad,     color: '#af52de' },
  viagem:      { label: 'Viagem',            icon: ICONS.plane,       color: '#5856d6' },
  educacao:    { label: 'Educação',          icon: ICONS.book,        color: '#64d2ff' },
  assinaturas: { label: 'Assinaturas',       icon: ICONS.repeat,      color: '#bf5af2' },
  compras:     { label: 'Compras',           icon: ICONS.shoppingBag, color: '#ffd60a' },
  outros:      { label: 'Outros',            icon: ICONS.package,     color: '#8e8e93' },
};

const INCOME_SOURCES = {
  salario:      { icon: ICONS.briefcase,   color: '#30d158', labelKey: 'exp.sources.salario' },
  freelance:    { icon: ICONS.wrench,      color: '#64d2ff', labelKey: 'exp.sources.freelance' },
  distribuicao: { icon: ICONS.pieChart,    color: '#c7f73e', labelKey: 'exp.sources.distribuicao' },
  dividendos:   { icon: ICONS.trendingUp,  color: '#d8fa72', labelKey: 'exp.sources.dividendos' },
  venda:        { icon: ICONS.tag,         color: '#ffd60a', labelKey: 'exp.sources.venda' },
  presente:     { icon: ICONS.gift,        color: '#ff9500', labelKey: 'exp.sources.presente' },
  outros:       { icon: ICONS.package,     color: '#8e8e93', labelKey: 'exp.sources.outros' },
};
// Opções do dropdown de Ganho (descrição). label = o que grava na descrição;
// source = categoria de renda usada no Resumo. Ganho é enxuto: descrição + valor + data.
const INCOME_OPTS = [
  { val: 'jcp_fiobras',       label: 'JCP FIOBRAS',        source: 'dividendos' },
  { val: 'div_fiobras',       label: 'Dividendos FIOBRAS', source: 'dividendos' },
  { val: 'prolabore_fiobras', label: 'Pró-labore FIOBRAS', source: 'salario' },
  { val: 'jcpdiv_acoes',      label: 'JCP/Div Ações',      source: 'dividendos' },
];
const MONTH_NAMES_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const MONTH_NAMES_EN = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export { ICONS, CATEGORIES, INCOME_SOURCES, INCOME_OPTS, MONTH_NAMES_PT, MONTH_NAMES_EN };
