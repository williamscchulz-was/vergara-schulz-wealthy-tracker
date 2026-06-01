// ============================================================
//  LEDGER - Personal Finance (app.js)
//  Modules: Expenses + Investments (I10 link)
// ============================================================
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, deleteDoc, collection, addDoc, onSnapshot, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ---- Firebase ----
const firebaseConfig = {
  apiKey: "AIzaSyA5zsPOxpOBPN8BVnJRIN0mIJ4gdlUntc8",
  authDomain: "wealthy-tracker-68658.firebaseapp.com",
  projectId: "wealthy-tracker-68658",
  storageBucket: "wealthy-tracker-68658.firebasestorage.app",
  messagingSenderId: "559892333696",
  appId: "1:559892333696:web:3272f0f8e86449f4885265"
};
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ============================================================
//  EARLY AUTH GUARD - login works even if main code crashes
// ============================================================
let _mainAuthRegistered = false;
onAuthStateChanged(auth, (user) => {
  if (user) {
    console.log('[early-auth] User logged in:', user.email);
    setTimeout(() => {
      if (!_mainAuthRegistered) {
        console.warn('[early-auth] Main auth did not register - reloading');
        location.reload();
      }
    }, 2000);
  }
});

const provider = new GoogleAuthProvider();

// ---- Paths ----
const colExpenses = () => collection(db, "household", "main", "expenses");
const colYearly   = () => collection(db, "household", "main", "dividendsYearly");
const colContrib  = () => collection(db, "household", "main", "contributions");
const docExpense  = (id) => doc(db, "household", "main", "expenses", id);
const docYearly   = (id) => doc(db, "household", "main", "dividendsYearly", id);
const docConfig   = doc(db, "household", "main", "config", "settings");
const docI10      = doc(db, "household", "main", "config", "i10");
const docI10Louise = doc(db, "household", "main", "config", "i10-louise");
const docFx = doc(db, "household", "main", "config", "fx");
const docI10Cfg   = doc(db, "household", "main", "config", "i10sync");
const docReserves = doc(db, "household", "main", "config", "reserves");
const docPension  = doc(db, "household", "main", "config", "pension");
const docBudgets  = doc(db, "household", "main", "config", "budgets");
const docUserPrefs = doc(db, "household", "main", "config", "userPrefs");

// Known primary account → defaults to Investments on first login.
// Any other UID defaults to Expenses (household spouse use case).
const KNOWN_PRIMARY_EMAIL = 'williamscchulz@gmail.com';

// ---- Constants ----
// Inline SVG icon registry (Lucide-style: stroke currentColor, 24x24 viewBox,
// round caps/joins). Keeping them as strings here avoids a separate fetch
// and lets us interpolate straight into innerHTML. Each icon is wrapped so
// renderers can do `${meta.icon}` exactly like before (now producing SVG
// instead of an emoji glyph).
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
  // Status / utility icons used outside the category lists
  check:        _svg('<polyline points="20 6 9 17 4 12"/>'),
  alertTri:     _svg('<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
  heart:        _svg('<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>'),
};

const CATEGORIES = {
  moradia:     { label: 'Moradia',           icon: ICONS.home,        color: '#0071e3' },
  alimentacao: { label: 'Alimentação',       icon: ICONS.utensils,    color: '#30d158' },
  transporte:  { label: 'Transporte',        icon: ICONS.car,         color: '#ff9500' },
  saude:       { label: 'Saúde',             icon: ICONS.heartPulse,  color: '#ff375f' },
  lazer:       { label: 'Lazer',             icon: ICONS.gamepad,     color: '#af52de' },
  educacao:    { label: 'Educação',          icon: ICONS.book,        color: '#64d2ff' },
  assinaturas: { label: 'Assinaturas',       icon: ICONS.repeat,      color: '#bf5af2' },
  cartao:      { label: 'Cartão de crédito', icon: ICONS.creditCard,  color: '#ff453a' },
  compras:     { label: 'Compras',           icon: ICONS.shoppingBag, color: '#ffd60a' },
  outros:      { label: 'Outros',            icon: ICONS.package,     color: '#8e8e93' },
};
// Income sources (labels resolved via i18n at render time)
const INCOME_SOURCES = {
  salario:      { icon: ICONS.briefcase,   color: '#30d158', labelKey: 'exp.sources.salario' },
  freelance:    { icon: ICONS.wrench,      color: '#64d2ff', labelKey: 'exp.sources.freelance' },
  distribuicao: { icon: ICONS.pieChart,    color: '#AC5FDB', labelKey: 'exp.sources.distribuicao' },
  dividendos:   { icon: ICONS.trendingUp,  color: '#E3A2EE', labelKey: 'exp.sources.dividendos' },
  venda:        { icon: ICONS.tag,         color: '#ffd60a', labelKey: 'exp.sources.venda' },
  presente:     { icon: ICONS.gift,        color: '#ff9500', labelKey: 'exp.sources.presente' },
  outros:       { icon: ICONS.package,     color: '#8e8e93', labelKey: 'exp.sources.outros' },
};
const MONTH_NAMES_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const MONTH_NAMES_EN = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// ---- State ----
const state = {
  user: null,
  mode: 'investments',          // 'expenses' | 'investments'
  expenses: [],
  yearly: [],
  i10: { equity: 0, dividends: 0, updatedAt: null, year: new Date().getFullYear(), assets: [], categories: [], monthly: [] },
  contributions: [],
  i10Cfg: { workerUrl: '', walletId: '', publicHash: '', autoSync: false },
  i10Louise: { equity: 0, dividends: 0, applied: 0, variation: 0, updatedAt: null },
  i10LouiseCfg: { walletId: '2699282' },
  fx: { usd: 0, rateUSD: 0, rateUpdatedAt: null, rateSource: '', note: '' },
  reserves: { accounts: [], loaded: false, editingId: null },
  pension:  { accounts: [], loaded: false, editingId: null },
  budgets: {},                   // { [categoryKey]: monthlyLimitBRL }
  userPrefs: {},                 // { [uid]: { defaultMode, updatedAt } }
  i10Syncing: false,
  dividendsYearlyGoal: 1_000_000,
  dividendsYearlyGoalYear: 2035,
  currentViewMonth: new Date(),  // month being viewed in Expenses
};

// ============================================================
//  i18n - declared early so functions can use t()
// ============================================================
const I18N = {
  pt: {
    'login.tagline': 'Ferramenta de finanças pessoais.<br/>Entre com Google para continuar.',
    'login.button': 'Entrar com Google',
    'hero.networth': 'Patrimônio total',
    'hero.sync': 'Sync',
    'hero.updated.never': 'ainda não atualizado',
    'hero.updated.prefix': 'atualizado',
    'goal.eyebrow': 'META DE LONGO PRAZO',
    'goal.variables': 'VARIÁVEIS',
    'card.portfolio': 'minha carteira',
    'card.dividends': 'dividendos por ano',
    'card.networth': 'patrimônio por ano',
    'card.monthlyreturn': 'rentabilidade mês a mês',
    'sub.monthlyreturn': 'variação percentual sobre o PL, Dietz modificado + proventos',
    'mr.see.table': 'Ver tabela detalhada',
    'mr.th.month': 'Mês',
    'mr.th.start': 'PL início',
    'mr.th.end': 'PL fim',
    'mr.th.contrib': 'Aporte',
    'mr.th.divs': 'Proventos',
    'mr.th.retbrl': 'Retorno',
    'mr.th.retpct': '%',
    'mr.empty': 'Sincronize com I10 pelo menos uma vez pra gerar o histórico mensal. A rentabilidade precisa de ≥2 meses de PL conhecidos.',
    'mr.avg': 'média {pct} · últimos {n} meses',
    'card.contributions': 'aportes mensais',
    'card.history': 'histórico anual',
    'tab.investments': 'Investimentos',
    'tab.expenses': 'Despesas',
    'th.year': 'Ano',
    'th.networth': 'Patrimônio',
    'th.dividends': 'Proventos',
    'th.dy': 'DY',
    'th.yoy': 'YoY',
    'stat.hitgoal': 'Meta atinge em',
    'stat.netat': 'PL em 2035',
    'stat.totalcontrib': 'Total aportado',
    'stat.projected': 'Projetado',
    'stat.projected.sub': '/ano no ano alvo',
    'stat.in.target': 'no ano alvo',
    'stat.total': 'total',
    'goal.see.chart': 'Ver gráfico',
    'goal.tweak': 'Ajustar variáveis',
    'reserve.label': 'Reserva de emergência',
    'reserve.empty.value': '— sem valor',
    'reserve.add': 'Adicionar conta',
    'reserve.modal.edit': 'Editar conta',
    'reserve.modal.add': 'Nova conta',
    'reserve.modal.sub': 'Reserva de emergência',
    'reserve.field.name': 'Nome da conta',
    'reserve.field.value': 'Valor (R$)',
    'reserve.count.singular': 'conta',
    'reserve.count.plural': 'contas',
    'pension.label': 'Previdência privada',
    'pension.empty.value': '— sem valor',
    'pension.add': 'Adicionar previdência',
    'pension.modal.edit': 'Editar previdência',
    'pension.modal.add': 'Nova previdência',
    'pension.modal.sub': 'Previdência privada',
    'pension.field.name': 'Instituição',
    'pension.field.value': 'Valor (R$)',
    'pension.count.singular': 'plano',
    'pension.count.plural': 'planos',
    'slider.monthly': 'Aporte mensal',
    'slider.growthcontrib': 'Crescimento aporte',
    'slider.dy': 'DY esperado',
    'slider.reinvest': 'Reinvestimento',
    'slider.growthdiv': 'Crescimento do dividendo (empresa)',
    'hero.manual': 'Atualização manual',
    'hero.manual.full': 'Atualização manual · configure o sync pra automático',
    'hero.return.label': 'com dividendos',
    'hero.applied': 'Aplicado',
    'ytd.received': 'proventos recebidos neste ano',
    'ytd.alltime.from': 'desde {year} · {n} {label} de histórico',
    'ytd.alltime.empty': 'sem histórico ainda',
    'years.singular': 'ano',
    'years.plural': 'anos',
    'loading': 'carregando...',
    'via.i10': 'VIA I10',
    'sub.dividends': 'histórico anual de proventos',
    'sub.networth': 'evolução do patrimônio',
    'sub.contributions': 'aportes em dinheiro do trabalho',
    'sub.history': 'patrimônio + proventos por ano',
    'contrib.total': 'total aportado',
    'contrib.avg': 'média mensal',
    'contrib.empty': 'Nenhum aporte cadastrado. Clique em "+ Aporte" para começar.',
    'contrib.aporte': 'aporte',
    'contrib.aportes': 'aportes',
    'goal.status.green': 'no ritmo',
    'goal.status.yellow': 'apertado',
    'goal.status.red': 'fora do prazo',
    'goal.notreach': 'não atinge',
    'goal.before': 'antes',
    'goal.after': 'depois',
    'goal.onschedule': 'no prazo',
    'toast.saved': 'Aporte salvo',
    'toast.deleted': 'Aporte excluído',
    'toast.error.save': 'Falha ao salvar',
    'toast.error.delete': 'Falha ao excluir',
    'toast.synced': 'Sincronizado',
    'toast.synced.assets': '{n} ativos',
    'count.assets.singular': 'ativo',
    'count.assets.plural': 'ativos',
    'count.cat.singular': 'categoria',
    'count.cat.plural': 'categorias',
    'count.assets.full': '{n} ativos · {c} categorias',
    'count.assets.none': 'nenhum ativo sincronizado',
    'cat.label.suffix': 'DA CARTEIRA',
    'cat.assets.singular': 'ATIVO',
    'cat.assets.plural': 'ATIVOS',
    'chart.caption.prefix': 'desde início:',
    'chart.caption.cagr': 'CAGR',
    'goal.phrase.suffix': ' Aporte de {amt}/mês cresce {g}%/ano. A carteira termina {year} valendo <b>{pl}</b>.',
    'goal.phrase.fail': 'Com essas variáveis você <b>não atinge</b> a meta. Aumente o aporte, o DY ou o reinvestimento.',
    'goal.phrase.before': 'Você atinge a meta em <b>{year}</b>, <span style="color:var(--purple-light);font-weight:600">{n} {label} antes</span>.',
    'goal.phrase.exact': 'Você atinge a meta exatamente em <b>{year}</b>.',
    'goal.phrase.after': 'Você só atinge R$ 1M/ano em <b>{year}</b>, <span style="color:var(--loss);font-weight:600">{n} {label} depois</span>. Aumente o aporte ou o DY esperado.',
    // ---- Expenses tab (Fase B: i18n de verdade) ----
    'exp.section.title': 'Despesas',
    'exp.section.meta': 'Lançamentos e orçamento do mês',
    'exp.new': '+ Nova despesa',
    'exp.hero.total': 'TOTAL DO MÊS',
    'exp.hero.balance': 'SALDO DO MÊS',
    'exp.hero.balance.sub': '{in} entraram · {out} saíram',
    'exp.hero.empty': 'Nenhum lançamento registrado ainda',
    'exp.hero.sub': '{n} {label} · média {avg}',
    'exp.count.singular': 'despesa',
    'exp.count.plural': 'despesas',
    'exp.stat.count': 'DESPESAS ESTE MÊS',
    'exp.stat.count.sub': 'Lançamentos registrados',
    'exp.stat.vs': 'VS MÊS ANTERIOR',
    'exp.stat.vs.empty': 'Sem dados do mês anterior',
    'exp.stat.vs.sub': '{diff} vs {prev}',
    'exp.stat.biggest': 'MAIOR DESPESA',
    'exp.card.bycat': 'Por categoria',
    'exp.card.bycat.sub': 'Distribuição do mês',
    'exp.card.recent': 'Lançamentos recentes',
    'exp.card.recent.sub': 'Últimas {n} despesas',
    'exp.card.all': 'Todas as despesas do mês',
    'exp.card.all.sub': 'Clique em uma linha para editar',
    'exp.th.date': 'Data',
    'exp.th.desc': 'Descrição',
    'exp.th.cat': 'Categoria',
    'exp.th.amount': 'Valor',
    'exp.empty.cat.title': 'Sem despesas',
    'exp.empty.cat.sub': 'Adicione a primeira despesa do mês.',
    'exp.empty.recent.title': 'Sem lançamentos',
    'exp.empty.recent.sub': 'Suas despesas recentes aparecerão aqui.',
    'exp.empty.table.title': 'Nenhuma despesa neste mês',
    'exp.empty.table.sub': 'Clique em "+ Nova despesa" para começar.',
    'exp.modal.new.title': 'Nova despesa',
    'exp.modal.new.sub': 'Registre uma despesa. A categoria pode ser editada depois.',
    'exp.modal.edit.title': 'Editar despesa',
    'exp.modal.edit.sub': 'Edite os detalhes abaixo ou exclua a despesa.',
    'exp.f.desc': 'Descrição',
    'exp.f.value': 'Valor (R$)',
    'exp.f.date': 'Data',
    'exp.f.cat': 'Categoria',
    'exp.f.notes': 'Notas (opcional)',
    'exp.f.desc.ph': 'Ex: Mercado, Netflix, Uber...',
    'exp.f.notes.ph': 'Detalhes adicionais...',
    'exp.btn.delete': 'Excluir',
    'exp.btn.cancel': 'Cancelar',
    'exp.btn.save': 'Salvar',
    'exp.btn.close': 'Fechar',
    'imp.btn': 'Importar fatura',
    'imp.title': 'Importar fatura do cartão (PDF)',
    'imp.modal.title': 'Revisar fatura',
    'imp.modal.sub': 'Confira de quem é o gasto e a categoria. Desmarque o que não quer importar.',
    'imp.count': 'lançamentos encontrados',
    'imp.reading': 'Lendo o PDF…',
    'imp.none': 'Não encontrei lançamentos nesse PDF. É o extrato do cartão?',
    'imp.fail.read': 'Não consegui ler esse PDF — tente outro arquivo.',
    'imp.confirm': 'Importar {n}',
    'imp.done': 'Importado: {n} lançamento(s)',
    'imp.alldup': 'Tudo isso já tinha sido importado.',
    'imp.importing': 'Importando…',
    'imp.ready': 'Pronto!',
    'imp.imported': 'lançamentos importados',
    'tab.resumo': 'Resumo',
    'rz.monthly': 'Mensal',
    'rz.annual': 'Anual',
    'rz.income': 'Ganhos',
    'rz.expenses': 'Despesas',
    'rz.savings': 'Economias',
    'rz.balance': 'Saldo',
    'rz.byCat': 'Despesas por categoria',
    'rz.byPerson': 'Resumo por pessoa',
    'rz.variable': 'Variáveis',
    'rz.fixed': 'Fixas',
    'rz.out': 'Saídas',
    'rz.in': 'Ganhos',
    'rz.empty': 'Sem despesas neste período.',
    'fx.modal.title': 'Dólar (USD)',
    'fx.modal.sub': 'Quanto você tem em dólar — convertido pela cotação atual.',
    'fx.f.usd': 'Quantidade em USD',
    'fx.rate.label': 'Cotação atual:',
    'exp.btn.saving': 'Salvando...',
    'exp.toast.saved': 'Despesa atualizada',
    'exp.toast.added': 'Despesa registrada',
    'exp.toast.deleted': 'Despesa excluída',
    'exp.toast.err.desc': 'Descrição obrigatória',
    'exp.toast.err.value': 'Valor deve ser maior que zero',
    'exp.toast.err.date': 'Data obrigatória',
    'exp.delete.title': 'Excluir despesa?',
    'exp.delete.income.title': 'Excluir ganho?',
    'exp.delete.sub': 'Esta ação não pode ser desfeita.',
    'exp.delete.confirm': 'Sim, excluir',
    // ---- Budget sub-feature ----
    'exp.budget.editTitle': 'Orçamento por categoria',
    'exp.budget.editSub': 'Defina um limite mensal para cada categoria. Deixe em branco para desativar.',
    'exp.budget.btn': 'Orçamento',
    'exp.budget.col.cat': 'Categoria',
    'exp.budget.col.limit': 'Limite mensal (R$)',
    'exp.budget.toast.saved': 'Orçamentos atualizados',
    'exp.budget.over': '{pct}% do limite',
    'exp.budget.of': 'de {limit}',
    'exp.budget.noLimit': 'sem limite',
    'exp.budget.total': 'Gasto / orçamento',
    'exp.budget.total.empty': 'Sem orçamento definido',
    // ---- Analytics cards (Fase C) ----
    'exp.daily.title': 'Ritmo diário',
    'exp.daily.sub': 'Gasto acumulado do mês',
    'exp.daily.legend.spent': 'Acumulado',
    'exp.daily.legend.pace': 'Ritmo esperado',
    'exp.daily.today': 'Hoje: {val}',
    'exp.daily.pace.ahead': '↑ {val} acima do ritmo',
    'exp.daily.pace.behind': '↓ {val} abaixo do ritmo',
    'exp.daily.pace.match': 'No ritmo · {val}/dia',
    'exp.trend.title': 'Últimos 12 meses',
    'exp.trend.sub': 'Gasto por categoria',
    'exp.trend.empty': 'Precisamos de mais meses de histórico pra gerar a tendência.',
    'exp.rec.title': 'Descrições recorrentes',
    'exp.rec.sub': 'Top do ano',
    'exp.rec.empty': 'Sem despesas repetidas ainda. Adicione algumas pra ver padrões.',
    'exp.rec.times': '{n}× · média {avg}',
    'exp.hero.over': '{n} categorias acima do orçamento',
    'exp.hero.over.one': '1 categoria acima do orçamento',
    'exp.search.ph': 'Buscar descrição, categoria, notas...',
    'exp.search.none': 'Nenhuma despesa encontrada para "{q}"',
    'exp.csv': 'CSV',
    'exp.csv.filename': 'despesas-{month}-{year}.csv',
    'exp.nw.label': 'PATRIMÔNIO DA CASA',
    'exp.nw.goto': 'Ver investimentos',
    // ---- Income/expense split ----
    'exp.type.expense': 'Saída',
    'exp.type.income': 'Ganho',
    'exp.new.income': '+ Ganho',
    'exp.f.source': 'Fonte',
    'exp.modal.income.new.title': 'Novo ganho',
    'exp.modal.income.new.sub': 'Registre uma entrada. A fonte pode ser editada depois.',
    'exp.modal.income.edit.title': 'Editar ganho',
    'exp.modal.income.edit.sub': 'Edite os detalhes abaixo ou exclua o ganho.',
    'exp.toast.income.added': 'Ganho registrado',
    'exp.toast.income.saved': 'Ganho atualizado',
    'exp.toast.income.deleted': 'Ganho excluído',
    'exp.income.pill': 'Ganho',
    'exp.sources.salario': 'Salário',
    'exp.sources.freelance': 'Freelance',
    'exp.sources.distribuicao': 'Distribuição',
    'exp.sources.dividendos': 'Dividendos',
    'exp.sources.venda': 'Venda',
    'exp.sources.presente': 'Presente',
    'exp.sources.outros': 'Outros',
    'exp.f.owner': 'De quem',
    'exp.f.nature': 'Tipo de despesa',
    'exp.nature.variavel': 'Variável',
    'exp.nature.fixa': 'Fixa',
    'exp.owner.william': 'William',
    'exp.owner.flavia': 'Flávia',
    'exp.owner.louise': 'Louise',
    'exp.owner.familia': 'Família',
    'exp.owner.joint': 'Família',
    'exp.owner.short.william': 'W',
    'exp.owner.short.flavia': 'F',
    'exp.owner.short.louise': 'L',
    'exp.owner.short.familia': 'Fam',
    'exp.owner.short.joint': 'Fam',
  },
  en: {
    'login.tagline': 'Personal finance tracker.<br/>Sign in with Google to continue.',
    'login.button': 'Sign in with Google',
    'hero.networth': 'Total net worth',
    'hero.sync': 'Sync',
    'hero.updated.never': 'not yet updated',
    'hero.updated.prefix': 'updated',
    'goal.eyebrow': 'LONG-TERM GOAL',
    'goal.variables': 'VARIABLES',
    'card.portfolio': 'my portfolio',
    'card.dividends': 'dividends per year',
    'card.networth': 'net worth per year',
    'card.monthlyreturn': 'monthly returns',
    'sub.monthlyreturn': 'modified Dietz, dividends-inclusive',
    'mr.see.table': 'See detailed table',
    'mr.th.month': 'Month',
    'mr.th.start': 'Start NW',
    'mr.th.end': 'End NW',
    'mr.th.contrib': 'Contrib',
    'mr.th.divs': 'Dividends',
    'mr.th.retbrl': 'Return',
    'mr.th.retpct': '%',
    'mr.empty': 'Sync with I10 at least once to seed the monthly history. Monthly return needs ≥2 known-NW months.',
    'mr.avg': 'avg {pct} · last {n} months',
    'card.contributions': 'monthly contributions',
    'card.history': 'yearly history',
    'tab.investments': 'Investments',
    'tab.expenses': 'Expenses',
    'th.year': 'Year',
    'th.networth': 'Net worth',
    'th.dividends': 'Dividends',
    'th.dy': 'DY',
    'th.yoy': 'YoY',
    'stat.hitgoal': 'Hit year',
    'stat.netat': 'Net worth',
    'stat.totalcontrib': 'Contributed',
    'stat.projected': 'Projected',
    'stat.projected.sub': '/yr in target year',
    'stat.in.target': 'in target year',
    'stat.total': 'total',
    'goal.see.chart': 'See chart',
    'goal.tweak': 'Tweak variables',
    'reserve.label': 'Emergency reserve',
    'reserve.empty.value': '— no value',
    'reserve.add': 'Add account',
    'reserve.modal.edit': 'Edit account',
    'reserve.modal.add': 'New account',
    'reserve.modal.sub': 'Emergency reserve',
    'reserve.field.name': 'Account name',
    'reserve.field.value': 'Value (R$)',
    'reserve.count.singular': 'account',
    'reserve.count.plural': 'accounts',
    'pension.label': 'Private pension',
    'pension.empty.value': '— no value',
    'pension.add': 'Add pension',
    'pension.modal.edit': 'Edit pension',
    'pension.modal.add': 'New pension',
    'pension.modal.sub': 'Private pension',
    'pension.field.name': 'Institution',
    'pension.field.value': 'Value (R$)',
    'pension.count.singular': 'plan',
    'pension.count.plural': 'plans',
    'slider.monthly': 'Monthly',
    'slider.growthcontrib': 'Contrib growth',
    'slider.dy': 'Expected DY',
    'slider.reinvest': 'Reinvestment',
    'slider.growthdiv': 'Dividend growth (company)',
    'hero.manual': 'Manual update',
    'hero.manual.full': 'Manual update · configure sync for automatic',
    'hero.return.label': 'with dividends',
    'hero.applied': 'Applied',
    'ytd.received': 'dividends received this year',
    'ytd.alltime.from': 'since {year} · {n} {label} of history',
    'ytd.alltime.empty': 'no history yet',
    'years.singular': 'year',
    'years.plural': 'years',
    'loading': 'loading...',
    'via.i10': 'VIA I10',
    'sub.dividends': 'annual dividend history',
    'sub.networth': 'net worth evolution',
    'sub.contributions': 'work-income contributions',
    'sub.history': 'net worth + dividends per year',
    'contrib.total': 'total contributed',
    'contrib.avg': 'monthly average',
    'contrib.empty': 'No contributions yet. Click "+ Aporte" to start.',
    'contrib.aporte': 'contribution',
    'contrib.aportes': 'contributions',
    'goal.status.green': 'on track',
    'goal.status.yellow': 'tight',
    'goal.status.red': 'off schedule',
    'goal.notreach': "doesn't reach",
    'goal.before': 'early',
    'goal.after': 'late',
    'goal.onschedule': 'on schedule',
    'toast.saved': 'Contribution saved',
    'toast.deleted': 'Contribution deleted',
    'toast.error.save': 'Save failed',
    'toast.error.delete': 'Delete failed',
    'toast.synced': 'Synced',
    'toast.synced.assets': '{n} assets',
    'count.assets.singular': 'asset',
    'count.assets.plural': 'assets',
    'count.cat.singular': 'category',
    'count.cat.plural': 'categories',
    'count.assets.full': '{n} assets · {c} categories',
    'count.assets.none': 'no assets synced',
    'cat.label.suffix': 'OF PORTFOLIO',
    'cat.assets.singular': 'ASSET',
    'cat.assets.plural': 'ASSETS',
    'chart.caption.prefix': 'since start:',
    'chart.caption.cagr': 'CAGR',
    'goal.phrase.suffix': ' Contribution of {amt}/mo grows {g}%/yr. Portfolio ends {year} worth <b>{pl}</b>.',
    'goal.phrase.fail': 'With these variables you <b>do not reach</b> the goal. Raise contribution, DY or reinvestment.',
    'goal.phrase.before': 'You reach the goal in <b>{year}</b>, <span style="color:var(--purple-light);font-weight:600">{n} {label} early</span>.',
    'goal.phrase.exact': 'You hit the goal exactly in <b>{year}</b>.',
    'goal.phrase.after': 'You only reach R$ 1M/year in <b>{year}</b>, <span style="color:var(--loss);font-weight:600">{n} {label} late</span>. Increase contribution or expected DY.',
    // ---- Expenses tab ----
    'exp.section.title': 'Expenses',
    'exp.section.meta': 'Monthly spending and budget',
    'exp.new': '+ New expense',
    'exp.hero.total': 'MONTH TOTAL',
    'exp.hero.balance': 'MONTH BALANCE',
    'exp.hero.balance.sub': '{in} in · {out} out',
    'exp.hero.empty': 'No entries recorded yet',
    'exp.hero.sub': '{n} {label} · avg {avg}',
    'exp.count.singular': 'expense',
    'exp.count.plural': 'expenses',
    'exp.stat.count': 'THIS MONTH',
    'exp.stat.count.sub': 'Entries recorded',
    'exp.stat.vs': 'VS PREVIOUS MONTH',
    'exp.stat.vs.empty': 'No data for last month',
    'exp.stat.vs.sub': '{diff} vs {prev}',
    'exp.stat.biggest': 'BIGGEST EXPENSE',
    'exp.card.bycat': 'By category',
    'exp.card.bycat.sub': 'Month distribution',
    'exp.card.recent': 'Recent entries',
    'exp.card.recent.sub': 'Last {n} expenses',
    'exp.card.all': 'All expenses this month',
    'exp.card.all.sub': 'Click a row to edit',
    'exp.th.date': 'Date',
    'exp.th.desc': 'Description',
    'exp.th.cat': 'Category',
    'exp.th.amount': 'Amount',
    'exp.empty.cat.title': 'No expenses',
    'exp.empty.cat.sub': 'Add the first expense of the month.',
    'exp.empty.recent.title': 'No entries',
    'exp.empty.recent.sub': 'Your recent expenses will show up here.',
    'exp.empty.table.title': 'No expenses this month',
    'exp.empty.table.sub': 'Click "+ New expense" to get started.',
    'exp.modal.new.title': 'New expense',
    'exp.modal.new.sub': 'Record an expense. Category can be edited later.',
    'exp.modal.edit.title': 'Edit expense',
    'exp.modal.edit.sub': 'Edit the details below or delete the expense.',
    'exp.f.desc': 'Description',
    'exp.f.value': 'Amount (R$)',
    'exp.f.date': 'Date',
    'exp.f.cat': 'Category',
    'exp.f.notes': 'Notes (optional)',
    'exp.f.desc.ph': 'Ex: Groceries, Netflix, Uber...',
    'exp.f.notes.ph': 'Additional details...',
    'exp.btn.delete': 'Delete',
    'exp.btn.cancel': 'Cancel',
    'exp.btn.save': 'Save',
    'exp.btn.close': 'Close',
    'imp.btn': 'Import statement',
    'imp.title': 'Import card statement (PDF)',
    'imp.modal.title': 'Review statement',
    'imp.modal.sub': "Check whose expense it is and the category. Uncheck anything you don't want to import.",
    'imp.count': 'entries found',
    'imp.reading': 'Reading the PDF…',
    'imp.none': 'No entries found in this PDF. Is it the card statement?',
    'imp.fail.read': "Couldn't read this PDF — try another file.",
    'imp.confirm': 'Import {n}',
    'imp.done': 'Imported: {n} entry(ies)',
    'imp.alldup': 'All of these were already imported.',
    'imp.importing': 'Importing…',
    'imp.ready': 'Done!',
    'imp.imported': 'entries imported',
    'tab.resumo': 'Summary',
    'rz.monthly': 'Monthly',
    'rz.annual': 'Annual',
    'rz.income': 'Income',
    'rz.expenses': 'Expenses',
    'rz.savings': 'Savings',
    'rz.balance': 'Balance',
    'rz.byCat': 'Expenses by category',
    'rz.byPerson': 'By person',
    'rz.variable': 'Variable',
    'rz.fixed': 'Fixed',
    'rz.out': 'Out',
    'rz.in': 'In',
    'rz.empty': 'No expenses in this period.',
    'fx.modal.title': 'US Dollar (USD)',
    'fx.modal.sub': 'How much you hold in dollars — converted at the current rate.',
    'fx.f.usd': 'Amount in USD',
    'fx.rate.label': 'Current rate:',
    'exp.btn.saving': 'Saving...',
    'exp.toast.saved': 'Expense updated',
    'exp.toast.added': 'Expense recorded',
    'exp.toast.deleted': 'Expense deleted',
    'exp.toast.err.desc': 'Description required',
    'exp.toast.err.value': 'Amount must be greater than zero',
    'exp.toast.err.date': 'Date required',
    'exp.delete.title': 'Delete expense?',
    'exp.delete.income.title': 'Delete income?',
    'exp.delete.sub': 'This action cannot be undone.',
    'exp.delete.confirm': 'Yes, delete',
    // ---- Budget sub-feature ----
    'exp.budget.editTitle': 'Monthly budget per category',
    'exp.budget.editSub': 'Set a monthly limit for each category. Leave blank to disable.',
    'exp.budget.btn': 'Budget',
    'exp.budget.col.cat': 'Category',
    'exp.budget.col.limit': 'Monthly limit (R$)',
    'exp.budget.toast.saved': 'Budgets updated',
    'exp.budget.over': '{pct}% of limit',
    'exp.budget.of': 'of {limit}',
    'exp.budget.noLimit': 'no limit',
    'exp.budget.total': 'Spent / budget',
    'exp.budget.total.empty': 'No budget set',
    // ---- Analytics cards ----
    'exp.daily.title': 'Daily pace',
    'exp.daily.sub': 'Cumulative spend this month',
    'exp.daily.legend.spent': 'Cumulative',
    'exp.daily.legend.pace': 'Expected pace',
    'exp.daily.today': 'Today: {val}',
    'exp.daily.pace.ahead': '↑ {val} above pace',
    'exp.daily.pace.behind': '↓ {val} below pace',
    'exp.daily.pace.match': 'On pace · {val}/day',
    'exp.trend.title': 'Last 12 months',
    'exp.trend.sub': 'Spend per category',
    'exp.trend.empty': 'Need more history to show a trend.',
    'exp.rec.title': 'Recurring descriptions',
    'exp.rec.sub': 'Top of the year',
    'exp.rec.empty': 'No repeated expenses yet. Add more to spot patterns.',
    'exp.rec.times': '{n}× · avg {avg}',
    'exp.hero.over': '{n} categories over budget',
    'exp.hero.over.one': '1 category over budget',
    'exp.search.ph': 'Search description, category, notes...',
    'exp.search.none': 'No expense found for "{q}"',
    'exp.csv': 'CSV',
    'exp.csv.filename': 'expenses-{month}-{year}.csv',
    'exp.nw.label': 'HOUSEHOLD NET WORTH',
    'exp.nw.goto': 'See investments',
    // ---- Income/expense split ----
    'exp.type.expense': 'Expense',
    'exp.type.income': 'Income',
    'exp.new.income': '+ Income',
    'exp.f.source': 'Source',
    'exp.modal.income.new.title': 'New income',
    'exp.modal.income.new.sub': 'Record an income. Source can be edited later.',
    'exp.modal.income.edit.title': 'Edit income',
    'exp.modal.income.edit.sub': 'Edit the details below or delete the income.',
    'exp.toast.income.added': 'Income recorded',
    'exp.toast.income.saved': 'Income updated',
    'exp.toast.income.deleted': 'Income deleted',
    'exp.income.pill': 'Income',
    'exp.sources.salario': 'Salary',
    'exp.sources.freelance': 'Freelance',
    'exp.sources.distribuicao': 'Distribution',
    'exp.sources.dividendos': 'Dividends',
    'exp.sources.venda': 'Sale',
    'exp.sources.presente': 'Gift',
    'exp.sources.outros': 'Other',
    'exp.f.owner': 'Whose',
    'exp.f.nature': 'Expense type',
    'exp.nature.variavel': 'Variable',
    'exp.nature.fixa': 'Fixed',
    'exp.owner.william': 'William',
    'exp.owner.flavia': 'Flávia',
    'exp.owner.louise': 'Louise',
    'exp.owner.familia': 'Family',
    'exp.owner.joint': 'Family',
    'exp.owner.short.william': 'W',
    'exp.owner.short.flavia': 'F',
    'exp.owner.short.louise': 'L',
    'exp.owner.short.familia': 'Fam',
    'exp.owner.short.joint': 'Fam',
  }
};

function getLang() { return localStorage.getItem('ledger-lang') || 'pt'; }

function t(key) {
  const lang = getLang();
  return (I18N[lang] && I18N[lang][key]) || (I18N.pt[key]) || key;
}
window.t = t;
window.getLang = getLang;

// Count-up: anima um número de onde estava até o alvo (o "delight" que o
// dono curtiu). Memo em el._cuVal pra só animar quando o valor muda;
// respeita prefers-reduced-motion (seta direto).
function countUpEl(el, target, fmt) {
  if (!el) return;
  target = +target || 0;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const from = typeof el._cuVal === 'number' ? el._cuVal : 0;
  el._cuVal = target;
  if (reduce || Math.abs(target - from) < 1) { el.textContent = fmt(target); return; }
  const dur = 650, t0 = performance.now();
  (function step(now) {
    let p = Math.min(1, (now - t0) / dur);
    p = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(from + (target - from) * p);
    if (p < 1) requestAnimationFrame(step);
  })(t0);
}

function applyI18n() {
  const lang = getLang();
  document.documentElement.setAttribute('lang', lang === 'en' ? 'en' : 'pt-BR');
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const val = t(key);
    if (val.includes('<')) el.innerHTML = val;
    else el.textContent = val;
  });
  // Placeholders (input/textarea)
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
  });
  // Tooltips (title) + aria-labels
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
  });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => {
    el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
  });
  // Update lang label in topbar
  const label = document.getElementById('langLabel');
  if (label) label.textContent = lang === 'pt' ? 'EN' : 'PT';
  // Re-render dynamic views ONLY if app is loaded and user is logged in
  try {
    if (typeof state !== 'undefined' && state && state.user) {
      if (state.mode === 'investments' && typeof renderInvestments === 'function') renderInvestments();
      if (state.mode === 'expenses' && typeof renderExpenses === 'function') renderExpenses();
    }
  } catch (err) {
    console.warn('[i18n] re-render skipped:', err);
  }
}

function toggleLang() {
  const next = getLang() === 'pt' ? 'en' : 'pt';
  try { localStorage.setItem('ledger-lang', next); } catch(e) {}
  applyI18n();
  if (state.user) {
    setDoc(docConfig, { lang: next, updatedAt: serverTimestamp() }, { merge: true }).catch(()=>{});
  }
}


// ---- Utils ----
const $ = (id) => document.getElementById(id);
// HTML-escape any string before injecting into innerHTML. Used on every
// user- or API-controlled value (expense desc/notes, account names, I10
// tickers/categories) to close stored-XSS sinks.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const fmtBRL = (n) => 'R$ ' + (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtBRL0 = (n) => 'R$ ' + (n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const fmtInt = (n) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtPct = (n) => (n >= 0 ? '+' : '') + n.toFixed(1) + '%';

// Currency helpers for typed BRL inputs ("R$ 1.234,56" ⇄ 1234.56).
// Tolerates raw numbers ("1234.56"), dot-thousands ("1.234,56"),
// and plain comma decimal ("1234,56").
function parseBRLInput(raw) {
  if (typeof raw === 'number') return raw;
  if (!raw) return 0;
  let s = String(raw).replace(/R\$\s?/gi, '').trim();
  if (!s) return 0;
  // If both '.' and ',' are present: '.' is thousands, ',' is decimal.
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  // Only ',': treat it as decimal.
  else if (s.includes(',')) s = s.replace(',', '.');
  // Only '.': ambiguous (decimal vs thousands). BR-correct heuristic:
  // if the segment after the LAST dot has exactly 3 digits, every dot is
  // a thousands separator → strip them all ('20.000'→20000, '1.234.567'→
  // 1234567). Otherwise the last dot is a decimal point ('12.50'→12.5,
  // '12.5'→12.5).
  else if (s.includes('.')) {
    const parts = s.split('.');
    if (parts[parts.length - 1].length === 3) s = parts.join('');
    else s = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1];
  }
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}
function fmtBRLInput(n) {
  if (n == null || n === '' || !isFinite(+n)) return '';
  return 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Normalize the I10 barchart response to [{ year, month, equity }] sorted
// ascending by (year, month). The upstream shape has drifted between API
// versions — we try a handful of common shapes and give up gracefully.
// Returns [] on anything unrecognized.
function parseI10Barchart(raw) {
  if (!raw) return [];
  // Possible shapes:
  //   [ { date: '2025-11-01', value: 123 }, ... ]
  //   { data: [ ... ] }
  //   { labels: ['Nov/25', ...], values: [123, ...] }
  //   [ { month: 11, year: 2025, equity: 123 }, ... ]
  let rows = [];
  if (Array.isArray(raw)) rows = raw;
  else if (Array.isArray(raw.data)) rows = raw.data;
  else if (Array.isArray(raw.values) && Array.isArray(raw.labels)) {
    // labels + values parallel arrays. Labels like "Nov/25" or "2025-11".
    rows = raw.labels.map((lab, i) => ({ label: lab, value: raw.values[i] }));
  } else if (Array.isArray(raw.result)) rows = raw.result;
  else return [];

  const parseLabel = (lab) => {
    if (!lab) return null;
    const s = String(lab);
    // Try YYYY-MM(-DD)
    let m = s.match(/^(\d{4})[-/](\d{1,2})/);
    if (m) return { year: +m[1], month: +m[2] };
    // Try MM/YY or MM/YYYY (I10's actual format — e.g. '05/25')
    m = s.match(/^(\d{1,2})\/(\d{2,4})$/);
    if (m) {
      const mo = +m[1];
      let yr = +m[2];
      if (mo < 1 || mo > 12) return null;
      if (yr < 100) yr += 2000;
      return { year: yr, month: mo };
    }
    // Try 'MonPT/YY' e.g. 'Nov/25'
    const monthMap = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12, feb: 2, apr: 4, may: 5, aug: 8, sep: 9, oct: 10, dec: 12 };
    m = s.match(/^([a-zA-Zç]{3})\/(\d{2,4})/i);
    if (m) {
      const mo = monthMap[m[1].toLowerCase()];
      if (!mo) return null;
      let yr = +m[2];
      if (yr < 100) yr += 2000;
      return { year: yr, month: mo };
    }
    return null;
  };

  const out = rows.map(r => {
    // I10 uses sum_equity as the canonical "patrimônio" field. We fall
    // through other names in case the upstream changes shape later.
    const equityRaw = r.sum_equity ?? r.equity ?? r.value ?? r.patrimony ?? r.patrimonio ?? r.total ?? 0;
    const equity = +equityRaw;
    let year = 0, month = 0;
    // I10's `month` and `date` fields are strings like '05/25', NOT
    // numeric. So parse the label first; only fall back to numeric
    // year/month if the upstream provided those explicitly.
    if (r.date || r.label || r.month) {
      const parsed = parseLabel(r.date || r.label || r.month);
      if (parsed) { year = parsed.year; month = parsed.month; }
    }
    if (!year && +r.year) year = +r.year;
    if (!month && typeof r.month === 'number') month = r.month;
    if (!year || !month || !isFinite(equity)) return null;
    return { year, month, equity };
  }).filter(Boolean);

  out.sort((a, b) => (a.year - b.year) || (a.month - b.month));
  return out;
}
function shortMoney(n) {
  if (Math.abs(n) >= 1_000_000) return (n/1_000_000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1_000) return (n/1_000).toFixed(0) + 'k';
  return n.toFixed(0);
}
function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}
// Parse a value into a Date WITHOUT the UTC-midnight timezone trap.
// `new Date('2026-05-01')` is parsed as UTC midnight → in BRT (UTC-3)
// that's Apr 30 21:00 local, so getMonth()/getDate() return the previous
// day. Expense dates are stored as date-only 'YYYY-MM-DD'; parse those
// as LOCAL dates. Anything else (Date objects, full timestamps) passes
// through to the native parser.
function parseLocalDate(d) {
  if (d instanceof Date) return d;
  if (typeof d === 'string') {
    const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  }
  return new Date(d);
}
function formatDateBR(d) {
  if (!d) return '-';
  const dt = parseLocalDate(d);
  return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
function formatDateTimeBR(d) {
  if (!d) return '-';
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toLocaleDateString('pt-BR', { day:'2-digit',month:'2-digit',year:'numeric'}) + ' ' + dt.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
}
function monthKey(d) {
  const dt = parseLocalDate(d);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`;
}
function monthLabel(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const names = getLang() === 'en' ? MONTH_NAMES_EN : MONTH_NAMES_PT;
  return `${names[dt.getMonth()]} ${dt.getFullYear()}`;
}

// Build the public I10 wallet link from i10Cfg (no hardcoded wallet/hash in HTML).
function updateI10Link() {
  const a = $('i10PublicLink');
  if (!a) return;
  const { walletId, publicHash } = state.i10Cfg;
  if (!walletId) { a.removeAttribute('href'); a.style.opacity = '0.5'; return; }
  const base = `https://investidor10.com.br/wallet/public/${walletId}`;
  a.href = publicHash ? `${base}?h=${publicHash}` : base;
  a.style.opacity = '';
}

// Sum of all reserve account values (treated as cash; counts in equity AND applied).
function reservesTotal() {
  const accs = state.reserves.accounts || [];
  return accs.reduce((s, a) => s + (+a.value || 0), 0);
}

// Sum of all pension (previdência privada) account values.
function pensionTotal() {
  const accs = state.pension.accounts || [];
  return accs.reduce((s, a) => s + (+a.value || 0), 0);
}

// Expose net equity (i10 + USD + reserves + pension) to the Goal Simulator via window.__ledgerEquity.
function updateLedgerEquity() {
  window.__ledgerEquity = calcTotalNetWorth();
  // Whenever the underlying numbers move, refresh the Expenses net-worth
  // pill if it's on screen (idempotent on Investments mode).
  renderExpensesNetWorthPill();
}

// Shared formula between the Investments hero and the Expenses pill.
// Mirrors renderInvestments' _heroTotal: I10 (W) + USD·rate + reserves
// + pension. Louise's wallet is tracked separately (as a chip) and
// intentionally NOT summed into the household total here.
// Monthly return calculator — modified Dietz with total return.
//
// Inputs:
//   monthlyEquity: [{ year, month, equity }] sorted asc (from I10 barchart)
//   contributions: state.contributions = [{ year, month, amount }]
//   dividends:     state.yearly = [{ year, amount, ... }] (yearly only — we
//                  distribute ratably across 12 months as a fallback when
//                  per-month dividend data isn't available)
//
// Output per month (except the first one, which has no 'start'):
//   { year, month, start, end, contrib, dividends, returnBRL, returnPct }
//
// Formula (modified Dietz):
//   cash_flow = contrib - dividends_received_in_month  // net cash in
//   return_brl = end - start - cash_flow
//   denom = start + (cash_flow / 2)
//   return_pct = denom > 0 ? return_brl / denom : 0
//
// "Total return" here: we ADD back dividends paid out to the return
// numerator by treating them as negative cash flow (they reduced end
// but shouldn't count as a withdrawal). This keeps the mental model
// "dividends are part of your return, not cash taken out".
function computeMonthlyReturns(monthlyEquity, contributions, yearlyDividends) {
  if (!Array.isArray(monthlyEquity) || monthlyEquity.length < 2) return [];

  // Build { 'YYYY-MM': amount } for contributions
  const contribMap = {};
  (contributions || []).forEach(c => {
    const k = `${+c.year}-${String(+c.month).padStart(2, '0')}`;
    contribMap[k] = (contribMap[k] || 0) + (+c.amount || 0);
  });

  // Distribute yearly dividends evenly across 12 months (best-effort
  // approximation; if a month has 0 equity it gets 0).
  const divMonthlyMap = {};
  (yearlyDividends || []).forEach(y => {
    // Field is `divs` (not `amount`) — see dividendsYearly schema.
    const per = (+y.divs || 0) / 12;
    for (let mo = 1; mo <= 12; mo++) {
      const k = `${+y.year}-${String(mo).padStart(2, '0')}`;
      divMonthlyMap[k] = (divMonthlyMap[k] || 0) + per;
    }
  });

  const out = [];
  for (let i = 1; i < monthlyEquity.length; i++) {
    const prev = monthlyEquity[i - 1];
    const curr = monthlyEquity[i];
    const k = `${curr.year}-${String(curr.month).padStart(2, '0')}`;
    const contrib = +contribMap[k] || 0;
    const divs = +divMonthlyMap[k] || 0;
    const start = +prev.equity || 0;
    const end = +curr.equity || 0;
    // Net external cash flow: contribution into the portfolio, minus
    // dividends paid out (which are part of return, not withdrawal).
    const cashFlow = contrib - divs;
    const returnBRL = end - start - cashFlow;
    const denom = start + cashFlow / 2;
    const returnPct = denom > 0 ? (returnBRL / denom) * 100 : 0;
    out.push({
      year: curr.year,
      month: curr.month,
      start,
      end,
      contrib,
      dividends: divs,
      returnBRL,
      returnPct,
    });
  }
  return out;
}

function calcTotalNetWorth() {
  const i10Eq = +state.i10.equity || 0;
  const usdBRL = (+state.fx.usd || 0) * (+state.fx.rateUSD || 0);
  return i10Eq + usdBRL + reservesTotal() + pensionTotal();
}

// Live household net worth pill shown on the Expenses tab.
// Hidden when we have no data at all yet (both i10.equity and FX empty).
function renderExpensesNetWorthPill() {
  const pill = $('expNwPill');
  if (!pill) return;
  const total = calcTotalNetWorth();
  if (total <= 0) { pill.hidden = true; return; }
  pill.hidden = false;
  $('expNwAmt').textContent = total.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  // Meta line: "atualizado DD/MM · via I10" or "manual" — mirrors investments hero
  const meta = $('expNwMeta');
  if (meta) {
    if (state.i10.updatedAt) {
      const sourceTag = state.i10.source === 'investidor10-sync' ? t('via.i10') : 'manual';
      meta.textContent = `${t('hero.updated.prefix')} ${formatDateTimeBR(state.i10.updatedAt)} · ${sourceTag}`;
    } else {
      meta.textContent = t('hero.updated.never');
    }
  }
}

// ============================================================
//                 RESUMO (planejamento) — aba dashboard
// ============================================================
let _resumoView = 'mensal';  // 'mensal' | 'anual'
const RZ_PERSON = { william: ['William', '#64d2ff', 'W'], flavia: ['Flávia', '#E3A2EE', 'F'], louise: ['Louise', '#30d158', 'L'], familia: ['Família', '#AC5FDB', 'Fam'] };
function setResumoView(v) { _resumoView = v === 'anual' ? 'anual' : 'mensal'; renderResumo(); }
function resumoNav(dir) {
  const d = state.currentViewMonth || new Date();
  state.currentViewMonth = _resumoView === 'anual'
    ? new Date(d.getFullYear() + dir, d.getMonth(), 1)
    : new Date(d.getFullYear(), d.getMonth() + dir, 1);
  renderResumo();
}
function renderResumo() {
  const body = $('resumoBody'); if (!body) return;
  const m = (typeof fmtBRL0 === 'function') ? fmtBRL0 : (n => 'R$ ' + Math.round(+n || 0).toLocaleString('pt-BR'));
  const vd = state.currentViewMonth || new Date();
  const annual = _resumoView === 'anual';
  const year = vd.getFullYear();
  const prefix = annual ? (year + '-') : (year + '-' + String(vd.getMonth() + 1).padStart(2, '0'));
  const MN = getLang() === 'en' ? MONTH_NAMES_EN : MONTH_NAMES_PT;
  const periodLabel = annual ? String(year) : (MN[vd.getMonth()] + ' ' + year);

  const items = (state.expenses || []).filter(e => (e.date || '').startsWith(prefix));
  const exp = items.filter(e => e.type !== 'income');
  const inc = items.filter(e => e.type === 'income');
  const sum = arr => arr.reduce((s, e) => s + (+e.value || 0), 0);
  const ganhos = sum(inc), despesas = sum(exp);
  const economias = (typeof reservesTotal === 'function' ? reservesTotal() : 0);
  const saldo = ganhos - despesas;

  let fixas = 0, variaveis = 0;
  for (const e of exp) { if (e.nature === 'fixa') fixas += (+e.value || 0); else variaveis += (+e.value || 0); }
  const byCat = {};
  for (const e of exp) { const c = e.category || 'outros'; byCat[c] = (byCat[c] || 0) + (+e.value || 0); }
  const catArr = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const byPerson = {};
  for (const o of OWNERS) byPerson[o] = { out: 0, inc: 0 };
  for (const e of exp) { const o = normOwner(e.owner) || 'familia'; if (!byPerson[o]) byPerson[o] = { out: 0, inc: 0 }; byPerson[o].out += (+e.value || 0); }
  for (const e of inc) { const o = normOwner(e.owner) || 'familia'; if (!byPerson[o]) byPerson[o] = { out: 0, inc: 0 }; byPerson[o].inc += (+e.value || 0); }

  const R = 66, CIRC = 2 * Math.PI * R, total = despesas || 1;
  let acc = 0;
  const segs = catArr.map(([c, v]) => {
    const len = (v / total) * CIRC;
    const col = (CATEGORIES[c] && CATEGORIES[c].color) || '#8e8e93';
    const s = `<circle cx="86" cy="86" r="${R}" fill="none" stroke="${col}" stroke-width="20" stroke-dasharray="${len.toFixed(2)} ${(CIRC - len).toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}" transform="rotate(-90 86 86)"/>`;
    acc += len; return s;
  }).join('');
  const fxPct = despesas > 0 ? Math.round(fixas / despesas * 100) : 0;
  const vrPct = despesas > 0 ? (100 - fxPct) : 0;

  const catRows = catArr.map(([c, v]) => {
    const col = (CATEGORIES[c] && CATEGORIES[c].color) || '#8e8e93';
    const label = (CATEGORIES[c] && CATEGORIES[c].label) || c;
    const pct = despesas > 0 ? Math.round(v / despesas * 100) : 0;
    return `<div class="rz-cat"><span class="rz-cat-dot" style="background:${col}"></span><div class="rz-cat-main"><div class="rz-cat-nm">${esc(label)}</div><div class="rz-bar"><i style="width:${pct}%;background:${col}"></i></div></div><span class="rz-cat-v">${m(v)}</span><span class="rz-cat-pct">${pct}%</span></div>`;
  }).join('') || `<div class="rz-empty">${esc(t('rz.empty'))}</div>`;

  const personRows = OWNERS.map(o => {
    const p = byPerson[o] || { out: 0, inc: 0 };
    const [nm, col, ini] = RZ_PERSON[o];
    return `<div class="rz-person"><div class="rz-av" style="background:${col}">${ini}</div><div class="rz-person-nm">${esc(nm)}</div><div class="rz-blk"><div class="rz-k">${esc(t('rz.out'))}</div><div class="rz-out">${m(p.out)}</div></div><div class="rz-blk"><div class="rz-k">${esc(t('rz.in'))}</div><div class="rz-in">${m(p.inc)}</div></div></div>`;
  }).join('');

  body.innerHTML = `
    <div class="rz-head">
      <div class="rz-seg">
        <button class="${annual ? '' : 'on'}" data-rzview="mensal">${esc(t('rz.monthly'))}</button>
        <button class="${annual ? 'on' : ''}" data-rzview="anual">${esc(t('rz.annual'))}</button>
      </div>
      <div class="rz-nav"><button data-rznav="-1" aria-label="anterior">‹</button><span class="rz-period">${esc(periodLabel)}</span><button data-rznav="1" aria-label="próximo">›</button></div>
    </div>
    <div class="rz-kpis">
      <div class="rz-kpi"><div class="rz-kpi-l">${esc(t('rz.income'))}</div><div class="rz-kpi-v">${m(ganhos)}</div></div>
      <div class="rz-kpi"><div class="rz-kpi-l">${esc(t('rz.expenses'))}</div><div class="rz-kpi-v">${m(despesas)}</div></div>
      <div class="rz-kpi"><div class="rz-kpi-l">${esc(t('rz.savings'))}</div><div class="rz-kpi-v rz-muted">${m(economias)}</div></div>
      <div class="rz-kpi rz-saldo"><div class="rz-kpi-l">${esc(t('rz.balance'))}</div><div class="rz-kpi-v ${saldo < 0 ? 'rz-neg' : 'rz-pos'}">${m(saldo)}</div></div>
    </div>
    <div class="rz-grid">
      <div class="rz-card">
        <div class="rz-card-h">${esc(t('rz.byCat'))}</div>
        <div class="rz-donut-wrap"><div class="rz-donut">
          <svg width="172" height="172" viewBox="0 0 172 172"><circle cx="86" cy="86" r="${R}" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="20"/>${segs}</svg>
          <div class="rz-donut-c"><span class="rz-dc-a">${esc(t('rz.variable'))} · ${vrPct}%</span><span class="rz-dc-b">${m(variaveis)}</span><span class="rz-dc-a" style="margin-top:6px">${esc(t('rz.fixed'))} · ${fxPct}%</span><span class="rz-dc-b" style="color:var(--ink-2)">${m(fixas)}</span></div>
        </div></div>
        <div class="rz-cats">${catRows}</div>
      </div>
      <div class="rz-card">
        <div class="rz-card-h">${esc(t('rz.byPerson'))}</div>
        <div class="rz-people">${personRows}</div>
      </div>
    </div>`;
  body.querySelectorAll('[data-rzview]').forEach(b => b.addEventListener('click', () => setResumoView(b.dataset.rzview)));
  body.querySelectorAll('[data-rznav]').forEach(b => b.addEventListener('click', () => resumoNav(+b.dataset.rznav)));
}

// ============================================================
//                 MODE SWITCH (Expenses/Invest)
// ============================================================
function switchMode(mode, opts = {}) {
  state.mode = mode;
  document.querySelectorAll('.mode-switch button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  document.querySelectorAll('.module').forEach(m => m.classList.remove('active'));
  if (mode === 'expenses') {
    $('moduleExpenses').classList.add('active');
    renderExpenses();
  } else if (mode === 'resumo') {
    $('moduleResumo').classList.add('active');
    renderResumo();
  } else {
    $('moduleInvestments').classList.add('active');
    renderInvestments();
  }
  // Persist this as the user's preferred default for next session.
  // `opts.persist === false` skips writing (used during the initial boot
  // so we don't overwrite the value we just read).
  if (opts.persist !== false && state.user?.uid) {
    const uid = state.user.uid;
    setDoc(docUserPrefs, {
      [uid]: { defaultMode: mode, updatedAt: serverTimestamp() }
    }, { merge: true }).catch(err => console.warn('[prefs] persist failed:', err));
  }
}

// Decide the initial mode for a just-logged-in user:
// 1. Previously-persisted choice in config/userPrefs.{uid}.defaultMode
// 2. Known primary email → 'investments'
// 3. Anyone else → 'expenses' (household spouse / secondary user)
async function pickInitialMode(user) {
  try {
    const snap = await getDoc(docUserPrefs);
    const data = snap.exists() ? (snap.data() || {}) : {};
    const persisted = data?.[user.uid]?.defaultMode;
    if (persisted === 'expenses' || persisted === 'investments') return persisted;
  } catch (err) {
    console.warn('[prefs] read failed, falling back to email default:', err);
  }
  const email = (user.email || '').toLowerCase().trim();
  return email === KNOWN_PRIMARY_EMAIL ? 'investments' : 'expenses';
}

// ============================================================
//                      EXPENSES MODULE
// ============================================================
function filterExpensesByMonth(date) {
  const targetKey = monthKey(date);
  return state.expenses.filter(e => {
    if (!e.date) return false;
    return monthKey(parseLocalDate(e.date)) === targetKey;
  });
}

// Legacy entries (pre-type-split) are treated as expenses.
const isIncome = (e) => e && e.type === 'income';
const isExpense = (e) => !isIncome(e);

// Resolve icon/color/label for any entry, handling both CATEGORIES and
// INCOME_SOURCES dictionaries.
function entryMeta(e) {
  if (isIncome(e)) {
    const s = INCOME_SOURCES[e.category] || INCOME_SOURCES.outros;
    return { icon: s.icon, color: s.color, label: t(s.labelKey) };
  }
  const c = CATEGORIES[e.category] || CATEGORIES.outros;
  return { icon: c.icon, color: c.color, label: c.label };
}

function renderExpenses() {
  const viewDate = state.currentViewMonth;
  const all = filterExpensesByMonth(viewDate);
  const monthExp = all.filter(isExpense);
  const monthIncome = all.filter(isIncome);
  const prevDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
  const prevMonthExp = filterExpensesByMonth(prevDate).filter(isExpense);

  const total = monthExp.reduce((s,e) => s + (+e.value||0), 0);
  const prevTotal = prevMonthExp.reduce((s,e) => s + (+e.value||0), 0);

  // Hero: "Saldo do mês" = ganhos − saídas
  $('currentMonthLabel').textContent = monthLabel(viewDate);
  const incomeTotal = monthIncome.reduce((s, e) => s + (+e.value || 0), 0);
  const saldo = incomeTotal - total;
  const heroAmtEl = $('expHeroAmt');
  const heroCurEl = document.querySelector('.exp-hero .amt .cur');
  const hero = document.querySelector('.exp-hero');
  // Amount: show absolute; class on hero signals sign (positive vs negative)
  countUpEl(heroAmtEl, Math.abs(saldo), n => Math.round(n).toLocaleString('pt-BR', { maximumFractionDigits: 0 }));
  if (hero) {
    hero.classList.toggle('is-positive', saldo >= 0 && (incomeTotal > 0 || total > 0));
    hero.classList.toggle('is-negative', saldo < 0);
  }
  // Prepend sign to currency label so "R$ 46" for positive, "−R$ 46" for negative
  if (heroCurEl) heroCurEl.textContent = saldo < 0 ? '− R$' : 'R$';
  // Subline: "↑ 46k entraram · ↓ 82k saíram" — or empty state
  const heroSub = $('expHeroSub');
  if (monthExp.length === 0 && monthIncome.length === 0) {
    heroSub.textContent = t('exp.hero.empty');
  } else {
    heroSub.innerHTML = t('exp.hero.balance.sub')
      .replace('{in}', `<span class="pos">↑ ${fmtBRL0(incomeTotal)}</span>`)
      .replace('{out}', `<span class="neg">↓ ${fmtBRL0(total)}</span>`);
  }
  // Label swap "TOTAL DO MÊS" → "SALDO DO MÊS" (also honored by data-i18n)
  const heroLabelEl = document.querySelector('.exp-hero-eyebrow .label');
  if (heroLabelEl) {
    heroLabelEl.setAttribute('data-i18n', 'exp.hero.balance');
    heroLabelEl.textContent = t('exp.hero.balance');
  }

  // Stats (expense-centric)
  $('expCount').textContent = monthExp.length;

  if (prevTotal > 0) {
    const diff = total - prevTotal;
    const pct = (diff / prevTotal) * 100;
    const arrow = diff >= 0 ? '↑' : '↓';
    $('expVsPrev').innerHTML = `<span class="${diff>=0?'neg':'pos'}">${arrow} ${fmtPct(Math.abs(pct) * (diff>=0?1:-1))}</span>`;
    const prevLabel = (getLang() === 'en' ? MONTH_NAMES_EN : MONTH_NAMES_PT)[prevDate.getMonth()];
    $('expVsPrevSub').textContent = t('exp.stat.vs.sub')
      .replace('{diff}', (diff>=0?'+':'') + fmtBRL0(diff))
      .replace('{prev}', prevLabel);
  } else {
    $('expVsPrev').textContent = '—';
    $('expVsPrevSub').textContent = t('exp.stat.vs.empty');
  }

  // Biggest expense
  if (monthExp.length > 0) {
    const biggest = [...monthExp].sort((a,b) => (+b.value||0) - (+a.value||0))[0];
    $('expBiggest').textContent = fmtBRL0(+biggest.value||0);
    $('expBiggestSub').textContent = biggest.description || '—';
  } else {
    $('expBiggest').textContent = '—';
    $('expBiggestSub').textContent = '—';
  }

  // Expense-only surfaces (category breakdown, daily chart, trend, recurring, budgets)
  const allExpHistory = (state.expenses || []).filter(isExpense);
  renderCategoryBreakdown(monthExp, total);
  renderDailyChart(monthExp, viewDate);
  renderTrend12m(allExpHistory, viewDate);
  renderTopRecurring(allExpHistory, viewDate);
  updateHeroOverBudgetBadge(monthExp);

  // Mixed surfaces (both income + expense — income rendered in green)
  renderRecentList(all);
  renderExpenseTable(all);

  renderExpensesNetWorthPill();
}

function renderCategoryBreakdown(monthExp, total) {
  const wrap = $('catList');
  const totalEl = $('expBudgetTotal');
  const budgets = state.budgets || {};

  if (monthExp.length === 0) {
    wrap.innerHTML = `<div class="exp-empty"><h4>${t('exp.empty.cat.title')}</h4><p>${t('exp.empty.cat.sub')}</p></div>`;
    if (totalEl) totalEl.hidden = true;
    return;
  }
  // Group by category (include cats with a budget even if no spend)
  const byCat = {};
  monthExp.forEach(e => {
    const cat = e.category || 'outros';
    byCat[cat] = (byCat[cat] || 0) + (+e.value||0);
  });
  Object.keys(budgets).forEach(k => { if (!(k in byCat)) byCat[k] = 0; });

  // Sort: rows with spending first (desc), then 0-spend budgeted cats alpha
  const sorted = Object.entries(byCat).sort((a, b) => {
    if (a[1] === 0 && b[1] === 0) return a[0].localeCompare(b[0]);
    return b[1] - a[1];
  });

  wrap.innerHTML = sorted.map(([catKey, val], idx) => {
    const cat = CATEGORIES[catKey] || CATEGORIES.outros;
    const limit = +budgets[catKey] || 0;
    // Bar width: % of month total if no budget; % of own limit if budgeted
    const barPct = limit > 0
      ? Math.min(100, (val / limit) * 100)
      : (total > 0 ? (val / total) * 100 : 0);
    const overBudget = limit > 0 && val > limit;
    const pctOfLimit = limit > 0 ? (val / limit) * 100 : null;
    const shareOfMonth = total > 0 ? (val / total) * 100 : 0;

    // Primary right-side value: % of limit (when budgeted) or % of month
    const rightPctStr = limit > 0 ? `${Math.round(pctOfLimit)}%` : `${Math.round(shareOfMonth)}%`;
    const amtStr = limit > 0
      ? `${fmtBRL0(val)} <span class="exp-cat-of">${t('exp.budget.of').replace('{limit}', fmtBRL0(limit))}</span>`
      : fmtBRL0(val);

    return `<div class="exp-cat-row${overBudget ? ' over-budget' : ''}${limit > 0 ? ' has-budget' : ''}" style="--cat-color:${cat.color};--cat-delay:${0.05 + idx * 0.04}s">
      <div class="exp-cat-icon">${cat.icon}</div>
      <div class="exp-cat-meta">
        <div class="exp-cat-name">${cat.label}</div>
        <div class="exp-cat-bar"><i style="--w:${barPct}%"></i></div>
      </div>
      <div class="exp-cat-v">
        <div class="exp-cat-pct">${rightPctStr}</div>
        <div class="exp-cat-amt">${amtStr}</div>
      </div>
    </div>`;
  }).join('');

  // Footer: total spent vs total budgeted (across categories that have a limit)
  if (totalEl) {
    const totalBudget = Object.values(budgets).reduce((s, v) => s + (+v || 0), 0);
    if (totalBudget > 0) {
      const totalSpentInBudgeted = Object.keys(budgets).reduce((s, k) => s + (byCat[k] || 0), 0);
      const pct = (totalSpentInBudgeted / totalBudget) * 100;
      const over = totalSpentInBudgeted > totalBudget;
      totalEl.hidden = false;
      totalEl.className = 'exp-budget-total' + (over ? ' over' : '');
      totalEl.innerHTML = `
        <div class="exp-budget-total-head">
          <span class="lbl">${t('exp.budget.total')}</span>
          <span class="v">${fmtBRL0(totalSpentInBudgeted)} <span class="sep">/</span> ${fmtBRL0(totalBudget)}</span>
        </div>
        <div class="exp-budget-total-bar"><i style="width:${Math.min(100, pct)}%"></i></div>
      `;
    } else {
      totalEl.hidden = true;
    }
  }
}

// Owner short chip renderer — returns '' when the owner tag adds no info
// (undefined or a legacy entry without owner field).
function ownerChipHtml(e) {
  const owner = normOwner(e.owner);
  if (!owner) return '';
  const short = t(`exp.owner.short.${owner}`);
  const full = t(`exp.owner.${owner}`);
  return `<span class="exp-owner-chip exp-owner-${owner}" title="${full}">${short}</span>`;
}

function renderRecentList(entries) {
  const wrap = $('recentList');
  if (entries.length === 0) {
    wrap.innerHTML = `<div class="exp-empty"><h4>${t('exp.empty.recent.title')}</h4><p>${t('exp.empty.recent.sub')}</p></div>`;
    $('recentMeta').textContent = '—';
    return;
  }
  const sorted = [...entries]
    .sort((a,b) => parseLocalDate(b.date).getTime() - parseLocalDate(a.date).getTime())
    .slice(0, 6);
  $('recentMeta').textContent = t('exp.card.recent.sub').replace('{n}', sorted.length);
  wrap.innerHTML = sorted.map((e, idx) => {
    const meta = entryMeta(e);
    const isIn = isIncome(e);
    const amt = (+e.value || 0);
    const amtText = isIn ? `+ ${fmtBRL(amt)}` : fmtBRL(amt);
    const ownerChip = ownerChipHtml(e);
    return `<div class="exp-recent-row${isIn ? ' is-income' : ''}" data-id="${e.id}" style="--cat-color:${meta.color};--row-delay:${0.05 + idx * 0.04}s">
      <div class="exp-recent-icon">${meta.icon}</div>
      <div class="exp-recent-main">
        <div class="exp-recent-desc">${esc(e.description) || '—'}${ownerChip}</div>
        <div class="exp-recent-meta">${formatDateBR(e.date)} · ${meta.label}</div>
      </div>
      <div class="exp-recent-amt">${amtText}</div>
    </div>`;
  }).join('');
  wrap.querySelectorAll('.exp-recent-row[data-id]').forEach(row =>
    row.addEventListener('click', () => openExpenseModal(row.dataset.id))
  );
}

// Keep last rendered month so CSV export + search filter can operate
// on the same dataset without re-querying state.
let _lastMonthExp = [];
let _expSearchQuery = '';

function renderExpenseTable(entries) {
  _lastMonthExp = entries;
  const tbody = $('expBody');
  if (entries.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="exp-empty"><h4>${t('exp.empty.table.title')}</h4><p>${t('exp.empty.table.sub')}</p></div></td></tr>`;
    return;
  }

  // Apply search filter (description + category/source label + notes +
  // owner full/short label, case-insensitive)
  const q = _expSearchQuery.trim().toLowerCase();
  const filtered = q
    ? entries.filter(e => {
        const meta = entryMeta(e);
        const hay = [
          e.description || '',
          e.notes || '',
          meta.label,
          isIncome(e) ? t('exp.income.pill') : '',
          e.owner ? t(`exp.owner.${e.owner}`) : '',
          e.owner ? t(`exp.owner.short.${e.owner}`) : '',
        ].join(' ').toLowerCase();
        return hay.includes(q);
      })
    : entries;

  if (filtered.length === 0) {
    const msg = t('exp.search.none').replace('{q}', _expSearchQuery.trim());
    tbody.innerHTML = `<tr><td colspan="4"><div class="exp-empty"><h4>${msg}</h4><p>${t('exp.empty.table.sub')}</p></div></td></tr>`;
    return;
  }

  const sorted = [...filtered].sort((a,b) => parseLocalDate(b.date).getTime() - parseLocalDate(a.date).getTime());
  tbody.innerHTML = sorted.map(e => {
    const meta = entryMeta(e);
    const isIn = isIncome(e);
    const notes = (e.notes || '').trim();
    const ownerChip = ownerChipHtml(e);
    const descMain = `<div class="exp-row-desc">${esc(e.description) || '—'}${ownerChip}</div>`;
    const descHtml = notes
      ? `${descMain}<div class="exp-row-notes" title="${esc(notes)}">${esc(notes)}</div>`
      : descMain;
    const amt = (+e.value || 0);
    const amtText = isIn ? `+ ${fmtBRL(amt)}` : fmtBRL(amt);
    const pillLabel = isIn ? t('exp.income.pill') : meta.label;
    return `<tr data-id="${e.id}" class="${isIn ? 'is-income' : ''}" style="--cat-color:${meta.color}">
      <td class="mono exp-row-date">${formatDateBR(e.date)}</td>
      <td class="exp-row-desc-cell">${descHtml}</td>
      <td><span class="exp-cat-pill ${isIn ? 'is-income' : ''}" style="--cat-color:${meta.color}"><span class="exp-cat-pill-icon">${meta.icon}</span>${pillLabel}</span></td>
      <td class="mono exp-row-amt">${amtText}</td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', () => openExpenseModal(tr.dataset.id)));
}

// CSV export of the currently viewed month (ignores search filter — users
// usually want the full month, not a filtered view).
function exportCurrentMonthCSV() {
  const monthExp = _lastMonthExp || [];
  const viewDate = state.currentViewMonth || new Date();
  const monthStr = String(viewDate.getMonth() + 1).padStart(2, '0');
  const yearStr = String(viewDate.getFullYear());
  const filename = t('exp.csv.filename').replace('{month}', monthStr).replace('{year}', yearStr);

  // CSV with BOM so Excel opens UTF-8 correctly. Separator = ';' (BR convention).
  const rows = [['Data', 'Tipo', 'De quem', 'Descrição', 'Categoria/Fonte', 'Valor (BRL)', 'Notas']];
  [...monthExp]
    .sort((a, b) => parseLocalDate(a.date) - parseLocalDate(b.date))
    .forEach(e => {
      const meta = entryMeta(e);
      const typeLabel = isIncome(e) ? t('exp.type.income') : t('exp.type.expense');
      const ownerLabel = e.owner ? t(`exp.owner.${e.owner}`) : '';
      const signed = (isIncome(e) ? +e.value : -Math.abs(+e.value || 0)).toFixed(2).replace('.', ',');
      rows.push([
        e.date || '',
        typeLabel,
        ownerLabel,
        (e.description || '').replace(/"/g, '""'),
        meta.label,
        signed,
        (e.notes || '').replace(/"/g, '""'),
      ]);
    });
  const csv = '\ufeff' + rows.map(r => r.map(cell => `"${cell}"`).join(';')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
}

// ============================================================
//                 EXPENSES - ANALYTICS (Fase C)
// ============================================================

// Daily spending sparkline: cumulative spend across the viewed month,
// overlaid with a dotted "expected pace" line (month total / days).
function renderDailyChart(monthExp, viewDate) {
  const svg = $('expDailyChart');
  const footer = $('expDailyFooter');
  if (!svg) return;

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const isCurrentMonth = (new Date().getFullYear() === year) && (new Date().getMonth() === month);
  const todayDay = isCurrentMonth ? new Date().getDate() : daysInMonth;

  // Aggregate per-day spend
  const perDay = new Array(daysInMonth + 1).fill(0); // 1-indexed
  monthExp.forEach(e => {
    const d = parseLocalDate(e.date);
    if (d.getFullYear() === year && d.getMonth() === month) {
      perDay[d.getDate()] += (+e.value || 0);
    }
  });

  const total = perDay.reduce((s, v) => s + v, 0);
  const cumul = new Array(daysInMonth + 1).fill(0);
  for (let i = 1; i <= daysInMonth; i++) cumul[i] = cumul[i - 1] + perDay[i];

  // Paint
  const W = 700, H = 180, PAD_X = 14, PAD_Y = 18;
  const xAt = d => PAD_X + ((d - 1) / Math.max(1, daysInMonth - 1)) * (W - PAD_X * 2);
  const maxY = Math.max(total, 1);
  const yAt = v => H - PAD_Y - (v / maxY) * (H - PAD_Y * 2);

  // Cumulative path (only up to today)
  const endDay = isCurrentMonth ? todayDay : daysInMonth;
  const cumPoints = [];
  for (let d = 1; d <= endDay; d++) cumPoints.push(`${xAt(d).toFixed(1)},${yAt(cumul[d]).toFixed(1)}`);
  const linePath = cumPoints.length ? `M ${cumPoints[0]} L ${cumPoints.slice(1).join(' L ')}` : '';
  const areaPath = cumPoints.length
    ? `M ${xAt(1).toFixed(1)},${(H - PAD_Y).toFixed(1)} L ${cumPoints.join(' L ')} L ${xAt(endDay).toFixed(1)},${(H - PAD_Y).toFixed(1)} Z`
    : '';

  // Expected pace line: starts at (1, 0), ends at (daysInMonth, total)
  const pacePath = `M ${xAt(1).toFixed(1)},${yAt(0).toFixed(1)} L ${xAt(daysInMonth).toFixed(1)},${yAt(total).toFixed(1)}`;

  // Weekend tint bands
  const bands = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month, d).getDay();
    if (dow === 0 || dow === 6) {
      const x = xAt(d - 0.5);
      const w = (W - PAD_X * 2) / Math.max(1, daysInMonth - 1);
      bands.push(`<rect x="${x.toFixed(1)}" y="${PAD_Y.toFixed(1)}" width="${w.toFixed(1)}" height="${(H - PAD_Y * 2).toFixed(1)}" fill="var(--ink-muted)" opacity="0.04"/>`);
    }
  }

  const todayX = xAt(todayDay);
  const todayY = yAt(cumul[endDay]);

  svg.innerHTML = `
    <defs>
      <linearGradient id="expDailyFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"  stop-color="var(--purple)"       stop-opacity="0.30"/>
        <stop offset="100%" stop-color="var(--purple)"      stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    ${bands.join('')}
    <path d="${pacePath}" stroke="var(--ink-3)" stroke-width="1.2" stroke-dasharray="3 4" fill="none" opacity="0.55"/>
    ${areaPath ? `<path d="${areaPath}" fill="url(#expDailyFill)"/>` : ''}
    ${linePath ? `<path d="${linePath}" fill="none" stroke="var(--purple-light)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 0 6px var(--purple-glow));"/>` : ''}
    ${cumPoints.length ? `<circle cx="${todayX.toFixed(1)}" cy="${todayY.toFixed(1)}" r="4" fill="var(--purple-light)" stroke="var(--bg-elevated)" stroke-width="2"/>` : ''}
  `;

  // Footer: pace comparison
  if (footer) {
    const expected = (total / daysInMonth) * endDay;
    const actual = cumul[endDay];
    const diff = actual - expected;
    const avgPerDay = endDay > 0 ? actual / endDay : 0;
    let paceHtml;
    if (total === 0) {
      paceHtml = `<span class="exp-daily-pace-label">${t('exp.daily.pace.match').replace('{val}', fmtBRL0(0))}</span>`;
    } else if (Math.abs(diff) < total * 0.02) {
      paceHtml = `<span class="exp-daily-pace-label match">${t('exp.daily.pace.match').replace('{val}', fmtBRL0(avgPerDay))}</span>`;
    } else if (diff > 0) {
      paceHtml = `<span class="exp-daily-pace-label neg">${t('exp.daily.pace.ahead').replace('{val}', fmtBRL0(Math.abs(diff)))}</span>`;
    } else {
      paceHtml = `<span class="exp-daily-pace-label pos">${t('exp.daily.pace.behind').replace('{val}', fmtBRL0(Math.abs(diff)))}</span>`;
    }
    footer.innerHTML = `
      <div class="exp-daily-today">${t('exp.daily.today').replace('{val}', fmtBRL0(actual))}</div>
      ${paceHtml}
    `;
  }
}

// 12-month stacked bar chart by category, ending in viewDate's month.
function renderTrend12m(allExp, viewDate) {
  const svg = $('expTrendChart');
  const legendEl = $('expTrendLegend');
  if (!svg) return;

  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(viewDate.getFullYear(), viewDate.getMonth() - i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth(), key: `${d.getFullYear()}-${d.getMonth()}` });
  }

  // Group sums by {monthKey, category}
  const byMonth = Object.fromEntries(months.map(m => [m.key, {}]));
  const categoriesSeen = new Set();
  allExp.forEach(e => {
    const d = parseLocalDate(e.date);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (!byMonth[key]) return;
    const cat = e.category || 'outros';
    byMonth[key][cat] = (byMonth[key][cat] || 0) + (+e.value || 0);
    categoriesSeen.add(cat);
  });

  const monthTotals = months.map(m => Object.values(byMonth[m.key]).reduce((s,v) => s+v, 0));
  const maxTotal = Math.max(1, ...monthTotals);

  // If no history at all, show empty state
  if (monthTotals.every(v => v === 0)) {
    svg.innerHTML = `<text x="350" y="120" text-anchor="middle" fill="var(--ink-muted)" font-size="12" font-family="Inter, sans-serif">${t('exp.trend.empty')}</text>`;
    if (legendEl) legendEl.innerHTML = '';
    return;
  }

  const W = 700, H = 240, PAD_X = 24, PAD_BOTTOM = 26, PAD_TOP = 12;
  const barGap = 6;
  const slot = (W - PAD_X * 2) / months.length;
  const barW = Math.max(8, slot - barGap);
  const plotH = H - PAD_BOTTOM - PAD_TOP;

  // Category draw order: by total desc (biggest at bottom of stack)
  const catTotals = {};
  categoriesSeen.forEach(c => {
    catTotals[c] = months.reduce((s, m) => s + (byMonth[m.key][c] || 0), 0);
  });
  const orderedCats = [...categoriesSeen].sort((a, b) => catTotals[b] - catTotals[a]);

  // Build bars
  const bars = months.map((m, i) => {
    const x = PAD_X + i * slot + (slot - barW) / 2;
    let y = H - PAD_BOTTOM;
    const total = monthTotals[i];
    const rects = orderedCats.map(cat => {
      const v = byMonth[m.key][cat] || 0;
      if (v <= 0) return '';
      const h = (v / maxTotal) * plotH;
      y -= h;
      const c = CATEGORIES[cat] || CATEGORIES.outros;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${c.color}" opacity="0.78" rx="1.5"><title>${c.label}: ${fmtBRL0(v)}</title></rect>`;
    }).join('');
    // Month label
    const labelY = H - PAD_BOTTOM + 14;
    const isCurrent = m.year === viewDate.getFullYear() && m.month === viewDate.getMonth();
    const monthChar = ['J','F','M','A','M','J','J','A','S','O','N','D'][m.month];
    const labelFill = isCurrent ? 'var(--purple-light)' : 'var(--ink-muted)';
    const labelWeight = isCurrent ? 700 : 500;
    // Total on top of bar (only if visible and not tiny)
    const totalLabel = total > 0 ? `<text x="${(x + barW/2).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle" fill="var(--ink-3)" font-size="9" font-family="'Geist Mono', monospace" opacity="0.7">${shortMoney(total)}</text>` : '';
    return `${rects}${totalLabel}<text x="${(x + barW/2).toFixed(1)}" y="${labelY}" text-anchor="middle" fill="${labelFill}" font-weight="${labelWeight}" font-size="10" font-family="'Geist Mono', monospace">${monthChar}</text>`;
  }).join('');

  svg.innerHTML = bars;

  // Legend (only categories that contributed this year)
  if (legendEl) {
    legendEl.innerHTML = orderedCats.map(cat => {
      const c = CATEGORIES[cat] || CATEGORIES.outros;
      return `<span class="exp-trend-legend-item"><span class="swatch" style="background:${c.color}"></span>${c.label}</span>`;
    }).join('');
  }
}

// Top recurring descriptions for the year-to-date of viewDate.
// Normalizes description casing/whitespace, groups, ranks by total spend.
function renderTopRecurring(allExp, viewDate) {
  const listEl = $('expRecList');
  if (!listEl) return;
  const year = viewDate.getFullYear();

  const groups = {};
  allExp.forEach(e => {
    const d = parseLocalDate(e.date);
    if (d.getFullYear() !== year) return;
    const raw = (e.description || '').trim();
    if (!raw) return;
    const key = raw.toLowerCase().replace(/\s+/g, ' ');
    if (!groups[key]) groups[key] = { label: raw, count: 0, total: 0, category: e.category || 'outros' };
    groups[key].count += 1;
    groups[key].total += (+e.value || 0);
  });

  const rows = Object.values(groups)
    .filter(g => g.count >= 2)
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);

  if (rows.length === 0) {
    listEl.innerHTML = `<div class="exp-empty"><h4>${t('exp.empty.recent.title')}</h4><p>${t('exp.rec.empty')}</p></div>`;
    return;
  }

  listEl.innerHTML = rows.map((g, idx) => {
    const c = CATEGORIES[g.category] || CATEGORIES.outros;
    const avg = g.total / g.count;
    return `<div class="exp-rec-row" style="--cat-color:${c.color};--row-delay:${0.05 + idx * 0.04}s">
      <div class="exp-rec-icon">${c.icon}</div>
      <div class="exp-rec-main">
        <div class="exp-rec-desc">${g.label}</div>
        <div class="exp-rec-meta">${t('exp.rec.times').replace('{n}', g.count).replace('{avg}', fmtBRL0(avg))}</div>
      </div>
      <div class="exp-rec-amt">${fmtBRL0(g.total)}</div>
    </div>`;
  }).join('');
}

// Over-budget hero badge: if any category exceeded its monthly limit, surface it.
function updateHeroOverBudgetBadge(monthExp) {
  const alertEl = $('expHeroAlert');
  if (!alertEl) return;
  const budgets = state.budgets || {};
  const byCat = {};
  monthExp.forEach(e => {
    const k = e.category || 'outros';
    byCat[k] = (byCat[k] || 0) + (+e.value || 0);
  });
  const over = Object.entries(budgets).filter(([k, v]) => (byCat[k] || 0) > +v).length;
  if (over === 0 || Object.keys(budgets).length === 0) {
    alertEl.hidden = true;
    alertEl.innerHTML = '';
    return;
  }
  const key = over === 1 ? 'exp.hero.over.one' : 'exp.hero.over';
  alertEl.hidden = false;
  alertEl.innerHTML = `<span class="exp-hero-overbudget">${ICONS.alertTri}${t(key).replace('{n}', over)}</span>`;
}

// ============================================================
//                 EXPENSES - MODAL
// ============================================================
let editingExpenseId = null;
let _modalType = 'expense'; // 'expense' | 'income'
let _modalOwner = 'familia';  // 'william' | 'flavia' | 'louise' | 'familia'
// New "de quem é o gasto" model. Legacy entries used 'joint' (W+F) →
// shown/edited as 'familia' (the shared/household bucket).
const OWNERS = ['william', 'flavia', 'louise', 'familia'];
const normOwner = (o) => (o === 'joint' ? 'familia' : o);

// Map Firebase Auth email → owner slot. William hardcoded; any other
// authenticated user defaults to Flávia (the spouse). 'joint' is a
// manual choice in the modal.
function ownerFromUser(user) {
  const email = (user?.email || '').toLowerCase().trim();
  if (email === KNOWN_PRIMARY_EMAIL) return 'william';
  return 'flavia';
}

function setModalOwner(owner) {
  owner = normOwner(owner);
  _modalOwner = OWNERS.includes(owner) ? owner : 'familia';
  document.querySelectorAll('#expenseModal .exp-owner-opt').forEach(b => {
    const on = b.dataset.owner === _modalOwner;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', String(on));
  });
}

let _modalNature = 'variavel';  // 'variavel' | 'fixa' (despesa fixa vs variável)
function setModalNature(nat) {
  _modalNature = nat === 'fixa' ? 'fixa' : 'variavel';
  document.querySelectorAll('#expenseModal .exp-nat-opt').forEach(b => {
    const on = b.dataset.nature === _modalNature;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', String(on));
  });
}

// Toggle the modal's internal state between expense and income. Swaps
// title/subtitle copy and which of {category, source} fields is visible.
function setModalType(type) {
  _modalType = type === 'income' ? 'income' : 'expense';
  document.querySelectorAll('#expenseModal .exp-type-opt').forEach(b => {
    const on = b.dataset.type === _modalType;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  // Swap category vs source field
  $('expCategoryField').hidden = _modalType === 'income';
  $('expSourceField').hidden = _modalType !== 'income';
  { const _nf = $('expNatureField'); if (_nf) _nf.hidden = _modalType === 'income'; }  // fixa/variável só faz sentido em despesa
  // Swap title/sub based on new type + edit/create context
  const editing = !!editingExpenseId;
  const titleKey = _modalType === 'income'
    ? (editing ? 'exp.modal.income.edit.title' : 'exp.modal.income.new.title')
    : (editing ? 'exp.modal.edit.title' : 'exp.modal.new.title');
  const subKey = _modalType === 'income'
    ? (editing ? 'exp.modal.income.edit.sub' : 'exp.modal.income.new.sub')
    : (editing ? 'exp.modal.edit.sub' : 'exp.modal.new.sub');
  $('expenseModalTitle').textContent = t(titleKey);
  $('expenseModalSub').textContent = t(subKey);
}

function openExpenseModal(id = null, opts = {}) {
  editingExpenseId = id;
  const today = new Date();
  if (id) {
    const e = state.expenses.find(x => x.id === id); if (!e) return;
    const type = e.type === 'income' ? 'income' : 'expense';
    setModalType(type);
    setModalOwner(e.owner || 'familia');
    setModalNature(e.nature || 'variavel');
    $('expDesc').value = e.description || '';
    $('expValue').value = fmtBRLInput(e.value);
    $('expDate').value = e.date || '';
    if (type === 'income') $('expSource').value = e.category || 'outros';
    else $('expCategory').value = e.category || 'outros';
    $('expNotes').value = e.notes || '';
    $('expDelete').style.display = '';
  } else {
    // Starting a new entry. `opts.type` overrides default (for '+ Ganho' btn).
    setModalType(opts.type === 'income' ? 'income' : 'expense');
    setModalOwner(ownerFromUser(state.user));
    setModalNature('variavel');
    $('expDesc').value = '';
    $('expValue').value = '';
    $('expDate').value = today.toISOString().split('T')[0];
    $('expCategory').value = 'outros';
    $('expSource').value = 'salario';
    $('expNotes').value = '';
    $('expDelete').style.display = 'none';
  }
  $('expenseModal').classList.add('show');
  setTimeout(() => $('expDesc').focus(), 50);
}
function closeExpenseModal() { $('expenseModal').classList.remove('show'); editingExpenseId = null; }

async function saveExpense() {
  const description = $('expDesc').value.trim();
  const value = parseBRLInput($('expValue').value);
  const date = $('expDate').value;
  const category = _modalType === 'income' ? $('expSource').value : $('expCategory').value;
  const notes = $('expNotes').value.trim();
  const type = _modalType;

  if (!description) { showToast(t('exp.toast.err.desc')); return; }
  if (!value || value <= 0) { showToast(t('exp.toast.err.value')); return; }
  if (!date) { showToast(t('exp.toast.err.date')); return; }

  const data = {
    type, description, value, date, category, notes,
    owner: _modalOwner,
    nature: type === 'income' ? null : _modalNature,
    updatedAt: serverTimestamp(),
    updatedBy: state.user?.displayName || 'unknown',
  };
  const btn = $('expSave');
  const originalLabel = t('exp.btn.save');
  try {
    btn.disabled = true; btn.textContent = t('exp.btn.saving');
    if (editingExpenseId) {
      await setDoc(docExpense(editingExpenseId), data, { merge: true });
      showToast(t(type === 'income' ? 'exp.toast.income.saved' : 'exp.toast.saved'));
    } else {
      await addDoc(colExpenses(), { ...data, createdAt: serverTimestamp() });
      showToast(t(type === 'income' ? 'exp.toast.income.added' : 'exp.toast.added'));
    }
    closeExpenseModal();
  } catch (err) { console.error(err); showToast(t('toast.error.save')); }
  finally { btn.disabled = false; btn.textContent = originalLabel; }
}

async function deleteExpense() {
  if (!editingExpenseId) return;
  const entry = state.expenses.find(x => x.id === editingExpenseId);
  const isIncome = entry?.type === 'income';
  openConfirmModal({
    title: t(isIncome ? 'exp.delete.income.title' : 'exp.delete.title'),
    sub: t('exp.delete.sub'),
    confirmLabel: t('exp.delete.confirm'),
    cancelLabel: t('exp.btn.cancel'),
    danger: true,
    onConfirm: async () => {
      try {
        await deleteDoc(docExpense(editingExpenseId));
        showToast(t(isIncome ? 'exp.toast.income.deleted' : 'exp.toast.deleted'));
        closeExpenseModal();
      } catch (err) { console.error(err); showToast(t('toast.error.delete')); }
    },
  });
}

// ============================================================
//                   INVESTMENTS MODULE
// ============================================================

// v8 Turno 8 — FX (USD holdings) render + edit
function openFXModal() {
  const modal = document.getElementById('fxModal');
  if (!modal) return;
  document.getElementById('fxModalInput').value = (+state.fx.usd || 0).toString().replace('.', ',');
  const rate = +state.fx.rateUSD || 0;
  document.getElementById('fxModalRate').textContent = rate > 0 ? 'R$ ' + rate.toFixed(2).replace('.', ',') : '—';
  const upd = state.fx.rateUpdatedAt;
  document.getElementById('fxModalRateDate').textContent = upd ? formatDateTimeBR(upd) : '';
  modal.classList.add('show');
}

function closeFXModal() {
  const modal = document.getElementById('fxModal');
  if (modal) modal.classList.remove('show');
}

async function saveFX() {
  const inputEl = document.getElementById('fxModalInput');
  let raw = inputEl ? String(inputEl.value || '') : '';
  // Remove thousand-separator dots, swap comma for dot (pt-BR to JS parseFloat format)
  raw = raw.split('.').join('');
  raw = raw.split(',').join('.');
  raw = raw.trim();
  const usd = parseFloat(raw) || 0;
  await setDoc(docFx, {
    usd,
    note: '',
    updatedBy: state.user?.displayName || 'unknown',
    updatedAt: serverTimestamp(),
  }, { merge: true });
  const m = document.getElementById('fxModal');
  if (m) m.style.display = 'none';
  showToast('USD atualizado: US$ ' + usd.toLocaleString('pt-BR'));
}

// v8 Turno 8 — refresh USD-BRL rate from worker (called on main Sync)
// v8 Turno 8 — FX modal event listeners (wired right after saveFX declaration so closures see it)
(function wireFXModal() {
  const _close = () => { const m = document.getElementById('fxModal'); if (m) m.style.display = 'none'; };
  document.getElementById('fxModalClose')?.addEventListener('click', _close);
  document.getElementById('fxModalCancel')?.addEventListener('click', _close);
  document.getElementById('fxModalSave')?.addEventListener('click', () => {
    try { saveFX(); } catch (e) { console.error('saveFX failed:', e); }
  });
  document.getElementById('fxModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'fxModal') _close();
  });
})();

async function fetchFXRate() {
  const workerUrl = state.i10Cfg.workerUrl || '';
  if (!workerUrl) return;
  try {
    const base = workerUrl.replace(/\/+$/, '');
    const r = await fetch(base + '/fx/rate', { headers: { 'Accept': 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    if (data && data.rateUSD) {
      await setDoc(docFx, {
        rateUSD: data.rateUSD,
        rateSource: data.rateSource || 'awesomeapi-bcb',
        rateUpdatedAt: data.rateUpdatedAt || new Date().toISOString(),
      }, { merge: true });
      console.log('FX rate refreshed \u2713', data.rateUSD);
    }
  } catch (err) {
    console.warn('FX rate refresh failed:', err);
  }
}

// ============================================================
//  MANUAL CASH CATEGORIES (Reserves + Pension)
//  Both follow the same pattern: list of {id, name, value} accounts
//  persisted in Firestore, summed into hero/applied totals.
// ============================================================
const RESERVES_DEFAULTS = [
  { id: 'bradesco', name: 'Bradesco', value: 0 },
  { id: 'xp',       name: 'XP Investimentos', value: 0 },
  { id: 'sicoob',   name: 'Sicoob', value: 0 },
];
const PENSION_DEFAULTS = [
  { id: 'bradesco', name: 'Bradesco', value: 0 },
];

// Per-type config — UI only; data shape is identical.
const CASH_CAT = {
  reserves: {
    docRef: () => docReserves,
    state: () => state.reserves,
    iconClass: 'reserve-icon',
    rowClass: 'reserve-row',
    countColor: '#34e17a',
    rowId: 'reserveRow',
    expId: 'reserveExpanded',
    addBtnId: 'resAddBtn',
    modalId: 'reserveModal',
    modalTitleId: 'reserveModalTitle',
    nameInputId: 'reserveNameInput',
    valueInputId: 'reserveValueInput',
    deleteBtnId: 'reserveDeleteBtn',
    iconSvg: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    label: () => t('reserve.label'),
    emptyLabel: () => t('reserve.empty.value'),
    addLabel: () => t('reserve.add'),
    editTitle: () => t('reserve.modal.edit'),
    addTitle: () => t('reserve.modal.add'),
    countSing: () => t('reserve.count.singular'),
    countPlur: () => t('reserve.count.plural'),
  },
  pension: {
    docRef: () => docPension,
    state: () => state.pension,
    iconClass: 'pension-icon',
    rowClass: 'pension-row',
    countColor: '#E3A2EE',
    rowId: 'pensionRow',
    expId: 'pensionExpanded',
    addBtnId: 'pensionAddBtn',
    modalId: 'pensionModal',
    modalTitleId: 'pensionModalTitle',
    nameInputId: 'pensionNameInput',
    valueInputId: 'pensionValueInput',
    deleteBtnId: 'pensionDeleteBtn',
    // Leaf icon (lucide leaf)
    iconSvg: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19.2 2.96c1.4 9.3-1.5 14.2-8.2 17.04Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6"/></svg>',
    label: () => t('pension.label'),
    emptyLabel: () => t('pension.empty.value'),
    addLabel: () => t('pension.add'),
    editTitle: () => t('pension.modal.edit'),
    addTitle: () => t('pension.modal.add'),
    countSing: () => t('pension.count.singular'),
    countPlur: () => t('pension.count.plural'),
  },
};

function _newCashId(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function persistCash(type) {
  const cfg = CASH_CAT[type];
  try {
    await setDoc(cfg.docRef(), {
      accounts: cfg.state().accounts,
      updatedAt: serverTimestamp(),
      updatedBy: state.user?.displayName || 'unknown',
    });
  } catch (err) {
    console.error('persistCash(' + type + ') failed:', err);
    showToast(t('toast.error.save'));
  }
}

function openCashModal(type, id) {
  const cfg = CASH_CAT[type];
  const modal = $(cfg.modalId);
  if (!modal) return;
  cfg.state().editingId = id;
  const acc = id ? cfg.state().accounts.find(a => a.id === id) : null;
  $(cfg.modalTitleId).textContent = acc ? cfg.editTitle() : cfg.addTitle();
  $(cfg.nameInputId).value = acc ? (acc.name || '') : '';
  const v = acc ? +acc.value || 0 : 0;
  $(cfg.valueInputId).value = v > 0 ? v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
  $(cfg.deleteBtnId).style.display = acc ? 'inline-block' : 'none';
  modal.classList.add('show');
  setTimeout(() => $(cfg.nameInputId).focus(), 50);
}

function closeCashModal(type) {
  const cfg = CASH_CAT[type];
  $(cfg.modalId)?.classList.remove('show');
  cfg.state().editingId = null;
}

async function saveCash(type) {
  const cfg = CASH_CAT[type];
  const name = ($(cfg.nameInputId).value || '').trim();
  let raw = String($(cfg.valueInputId).value || '').trim();
  raw = raw.split('.').join('').split(',').join('.');
  const value = parseFloat(raw) || 0;
  if (!name) { showToast('Nome obrigatório'); return; }
  const id = cfg.state().editingId;
  const accs = cfg.state().accounts;
  if (id) {
    const idx = accs.findIndex(a => a.id === id);
    if (idx >= 0) accs[idx] = { ...accs[idx], name, value };
  } else {
    accs.push({ id: _newCashId(type === 'pension' ? 'p' : 'r'), name, value });
  }
  await persistCash(type);
  closeCashModal(type);
}

async function deleteCash(type) {
  const cfg = CASH_CAT[type];
  const id = cfg.state().editingId;
  if (!id) return;
  openConfirmModal({
    title: type === 'pension' ? 'Excluir previdência?' : 'Excluir conta?',
    sub: 'Esta ação não pode ser desfeita.',
    confirmLabel: 'Sim, excluir',
    danger: true,
    onConfirm: async () => {
      cfg.state().accounts = cfg.state().accounts.filter(a => a.id !== id);
      await persistCash(type);
      closeCashModal(type);
    },
  });
}

// Render category row + expanded list inside the My Portfolio wrap.
function renderCashRow(type, wrap) {
  if (!wrap) return;
  const cfg = CASH_CAT[type];
  const accs = cfg.state().accounts || [];
  const total = accs.reduce((s, a) => s + (+a.value || 0), 0);
  const usdBRL = (+state.fx.usd || 0) * (+state.fx.rateUSD || 0);
  const denominator = (+state.i10.equity || 0) + usdBRL + reservesTotal() + pensionTotal();
  const percent = denominator > 0 ? (total / denominator) * 100 : 0;
  const cntLbl = accs.length === 1 ? cfg.countSing() : cfg.countPlur();

  let itemsHtml = '';
  for (const a of accs) {
    const v = +a.value || 0;
    const valHtml = v > 0
      ? '<span class="res-val">R$ ' + v.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + '</span>'
      : '<span class="res-val empty">' + cfg.emptyLabel() + '</span>';
    itemsHtml += '<div class="res-item" data-rid="' + a.id + '">' +
      '<span class="res-name">' + esc(a.name || '-') + '</span>' +
      '<div class="res-actions">' + valHtml +
        '<button class="res-edit" data-rid="' + a.id + '" type="button" aria-label="Edit">' +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>' +
        '</button>' +
      '</div>' +
    '</div>';
  }
  itemsHtml += '<button class="res-add" id="' + cfg.addBtnId + '" type="button">' +
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
    cfg.addLabel() +
  '</button>';

  const html =
    '<div class="cat-row ' + cfg.rowClass + ' clickable" id="' + cfg.rowId + '">' +
      '<div class="cat-icon ' + cfg.iconClass + '">' + cfg.iconSvg + '</div>' +
      '<div class="cat-info">' +
        '<div class="cat-name">' + cfg.label() + '</div>' +
        '<div class="cat-count" style="color:' + cfg.countColor + '">' + accs.length + ' ' + cntLbl + ' &middot; ' + percent.toFixed(0) + '% ' + t('cat.label.suffix') + '</div>' +
      '</div>' +
      '<div><div class="cat-value">R$ ' + total.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + '</div></div>' +
      '<svg class="cat-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>' +
    '</div>' +
    '<div class="reserve-expanded" id="' + cfg.expId + '">' + itemsHtml + '</div>';

  wrap.insertAdjacentHTML('beforeend', html);

  // Wire up
  const row = document.getElementById(cfg.rowId);
  const exp = document.getElementById(cfg.expId);
  row?.addEventListener('click', (e) => {
    if (e.target.closest('.res-edit, .res-add, .res-item')) return;
    row.classList.toggle('expanded');
    exp.classList.toggle('open');
  });
  document.getElementById(cfg.addBtnId)?.addEventListener('click', (e) => {
    e.stopPropagation();
    openCashModal(type, null);
  });
  exp?.querySelectorAll('.res-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openCashModal(type, btn.dataset.rid);
    });
  });
}

// Backwards-compat aliases (used by wireReserveModal in HTML wiring)
const renderReservesRow = (wrap) => renderCashRow('reserves', wrap);
const openReserveModal  = (id) => openCashModal('reserves', id);
const closeReserveModal = () => closeCashModal('reserves');
const saveReserve       = () => saveCash('reserves');
const deleteReserve     = () => deleteCash('reserves');

// Wire modals AFTER const declarations above so TDZ doesn't fire on load.
(function wireReserveModal() {
  document.getElementById('reserveModalCancel')?.addEventListener('click', closeReserveModal);
  document.getElementById('reserveModalSave')?.addEventListener('click', () => {
    try { saveReserve(); } catch (e) { console.error('saveReserve failed:', e); }
  });
  document.getElementById('reserveDeleteBtn')?.addEventListener('click', () => {
    try { deleteReserve(); } catch (e) { console.error('deleteReserve failed:', e); }
  });
  document.getElementById('reserveModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'reserveModal') closeReserveModal();
  });
})();

(function wirePensionModal() {
  document.getElementById('pensionModalCancel')?.addEventListener('click', () => closeCashModal('pension'));
  document.getElementById('pensionModalSave')?.addEventListener('click', () => {
    try { saveCash('pension'); } catch (e) { console.error('savePension failed:', e); }
  });
  document.getElementById('pensionDeleteBtn')?.addEventListener('click', () => {
    try { deleteCash('pension'); } catch (e) { console.error('deletePension failed:', e); }
  });
  document.getElementById('pensionModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'pensionModal') closeCashModal('pension');
  });
})();

function renderInvestments() {
  const currentYear = new Date().getFullYear();
  const goalYear = state.dividendsYearlyGoalYear;
  const yearsLeft = Math.max(0, goalYear - currentYear);

  // Hero - Patrimônio
  // v8 Turno 8: hero total includes USD converted to BRL
  // + reserves (cash position, no P&L)
  const _usdBRL = (+state.fx.usd || 0) * (+state.fx.rateUSD || 0);
  const _reservesBRL = reservesTotal();
  const _pensionBRL = pensionTotal();
  const _heroTotal = (+state.i10.equity || 0) + _usdBRL + _reservesBRL + _pensionBRL;
  countUpEl($('i10Equity'), _heroTotal, n => Math.round(n).toLocaleString('pt-BR', { maximumFractionDigits: 0 }));

  // USD equivalent (only shown when we have a valid FX rate)
  const _usdEqEl = $('i10EquityUSD');
  const _usdValEl = $('i10EquityUSDVal');
  if (_usdEqEl && _usdValEl) {
    const rate = +state.fx.rateUSD || 0;
    if (rate > 0 && _heroTotal > 0) {
      const usdEq = _heroTotal / rate;
      _usdValEl.textContent = usdEq.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
      _usdEqEl.style.display = 'flex';
    } else {
      _usdEqEl.style.display = 'none';
    }
  }
  if (state.i10.updatedAt) {
    const sourceTag = state.i10.source === 'investidor10-sync' ? ' · via I10' : ' · manual';
    $('i10Updated').textContent = t('hero.updated.prefix') + ' ' + formatDateTimeBR(state.i10.updatedAt) + sourceTag;
  } else {
    $('i10Updated').textContent = t('hero.updated.never');
  }
  // Hero meta row: return pill + applied text
  const subEl = $('i10EquitySub');
  if (subEl) {
    if (state.i10.source === 'investidor10-sync' && state.i10.applied > 0) {
      const ytdDivs = +state.i10.dividends || 0;
      const pastDivs = state.yearly
        .filter(y => y.year < currentYear)
        .reduce((s, y) => s + (+y.divs || 0), 0);
      const totalDivs = ytdDivs + pastDivs;
      // USD holdings + reserves + pension count as both equity AND applied
      const _appliedTotal = (+state.i10.applied || 0) + _usdBRL + _reservesBRL + _pensionBRL;
      const totalReturn = ((_heroTotal - _appliedTotal + totalDivs) / _appliedTotal) * 100;
      const sign = totalReturn >= 0 ? '+' : '';
      const arrow = totalReturn >= 0
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/></svg>';
      const pillCls = totalReturn >= 0 ? 'return-pill' : 'return-pill neg';
      subEl.innerHTML = `<div class="${pillCls}">${arrow}${sign}${totalReturn.toFixed(2)}% ${t('hero.return.label')}</div><div class="applied-text">${t('hero.applied')} <b>${fmtBRL0(_appliedTotal)}</b></div>`;
    } else {
      subEl.innerHTML = `<div class="applied-text">${t('hero.manual.full')}</div>`;
    }
  }

  // Secondary cards
  $('i10Year').textContent = currentYear;
  $('i10Dividends').textContent = (state.i10.dividends || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });

  const remaining = Math.max(0, state.dividendsYearlyGoal - (state.i10.dividends || 0));
  $('goalRemaining').textContent = remaining.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  $('goalYearsLeft').textContent = yearsLeft;

  // Progress
  const progress = state.dividendsYearlyGoal > 0
    ? ((state.i10.dividends || 0) / state.dividendsYearlyGoal) * 100
    : 0;
  $('progressPct').textContent = progress.toFixed(1) + '%';
  $('progressSub').textContent = `${fmtBRL0(state.i10.dividends || 0)} de ${fmtBRL0(state.dividendsYearlyGoal)}`;

  // History years count
  $('historyYears').textContent = state.yearly.length;

  // PL total growth (2020 → current)
  const sortedYearly = [...state.yearly].filter(y => y.equity != null).sort((a,b) => a.year - b.year);
  if (sortedYearly.length >= 2) {
    const first = sortedYearly[0];
    const lastEquity = state.i10.equity > 0 ? state.i10.equity : (sortedYearly[sortedYearly.length-1].equity || 0);
    const yearsSpan = currentYear - first.year;
    if (first.equity > 0 && yearsSpan > 0) {
      const totalGrowth = ((lastEquity - first.equity) / first.equity) * 100;
      const cagr = (Math.pow(lastEquity / first.equity, 1 / yearsSpan) - 1) * 100;
      $('plTotalGrowth').textContent = (totalGrowth >= 0 ? '+' : '') + totalGrowth.toFixed(0) + '%';
      $('plCagr').textContent = `${cagr.toFixed(1)}%/ano`;
      $('plSinceFirst').textContent = (totalGrowth >= 0 ? '+' : '') + totalGrowth.toFixed(0) + '%';
      $('plCagrPill').textContent = cagr.toFixed(1) + '% /ano';
    }
  } else {
    $('plTotalGrowth').textContent = '-';
    $('plCagr').textContent = '-';
    $('plSinceFirst').textContent = '-';
    $('plCagrPill').textContent = '-';
  }

  // All-time dividends = soma dos anos passados (dividendsYearly, que
  // exclui o ano corrente) + os proventos YTD do ano corrente (vêm do
  // sync I10 em state.i10.dividends). Filtra o ano corrente do
  // dividendsYearly pra não contar em dobro caso alguém tenha cadastrado
  // o ano corrente manualmente.
  const pastDivs = state.yearly
    .filter(y => +y.year < currentYear)
    .reduce((s, y) => s + (+y.divs || 0), 0);
  const allTime = pastDivs + (+state.i10.dividends || 0);
  // Pair element already has a static <span class="cur">R$</span> sibling
  // in the HTML, so we render just the number here (matches i10Dividends).
  $('divAllTime').textContent = (allTime || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });

  // YTD progress bar (% of yearly goal)
  const ytdProgressEl = document.getElementById('ytdProgressBar');
  if (ytdProgressEl) {
    const pct = state.dividendsYearlyGoal > 0
      ? Math.min(100, ((state.i10.dividends || 0) / state.dividendsYearlyGoal) * 100)
      : 0;
    ytdProgressEl.style.width = pct.toFixed(1) + '%';
  }

  // All-time sub: "desde 2020 - X anos de historico"
  const allTimeSubEl = document.getElementById('divAllTimeSub');
  if (allTimeSubEl) {
    if (sortedYearly.length > 0) {
      const firstYear = sortedYearly[0].year;
      const yearsCount = sortedYearly.length;
      const yLabel = yearsCount === 1 ? t('years.singular') : t('years.plural');
      allTimeSubEl.textContent = t('ytd.alltime.from')
        .replace('{year}', firstYear)
        .replace('{n}', yearsCount)
        .replace('{label}', yLabel);
    } else {
      allTimeSubEl.textContent = t('ytd.alltime.empty');
    }
  }

  // All-time progress bar (proporcional ao valor recebido vs uma meta acumulada simbolica)
  const allTimeProgressEl = document.getElementById('allTimeProgressBar');
  if (allTimeProgressEl) {
    // 35% como visual fixo - representa "progresso da jornada"
    const accumGoal = state.dividendsYearlyGoal * 5; // 5x meta anual como referencia visual
    const pct = accumGoal > 0 ? Math.min(100, (allTime / accumGoal) * 100) : 0;
    allTimeProgressEl.style.width = pct.toFixed(1) + '%';
  }

  // Carteira count: "X ativos · Y categorias"
  const countEl = document.getElementById('i10AssetsCount');
  if (countEl) {
    const assets = state.i10.assets || [];
    if (assets.length === 0) {
      countEl.textContent = t('count.assets.none');
    } else {
      const cats = new Set(assets.map(a => inferCategory(a)));
      const aLbl = assets.length === 1 ? t('count.assets.singular') : t('count.assets.plural');
      const cLbl = cats.size === 1 ? t('count.cat.singular') : t('count.cat.plural');
      countEl.textContent = `${assets.length} ${aLbl} · ${cats.size} ${cLbl}`;
    }
  }

  // Pills
  $('divGoalPill').textContent = 'R$ 1M até ' + goalYear;
  $('divYearsLeft').textContent = yearsLeft + (yearsLeft === 1 ? ' ano' : ' anos');
  $('divProgress').textContent = progress.toFixed(1) + '%';

  renderDividendsChart();
  renderPLChart();
  renderYearlyTable();
  renderI10Assets();
  renderMonthlyReturns();
  renderContributions();
}

// v8 Turno 6 — Bar chart range state (1Y / 5Y / All)
window.chartRange = window.chartRange || '5Y';
function filterByRange(years, values, range) {
  if (range === 'All') return { years, values };
  if (range === '1Y') {
    const n = years.length;
    return n > 0 ? { years: [years[n-1]], values: [values[n-1]] } : { years: [], values: [] };
  }
  const N = 5;
  if (years.length <= N) return { years, values };
  return { years: years.slice(-N), values: values.slice(-N) };
}

function buildBarChart(years, values, opts = {}) {
  // Mobile detection: narrower viewBox + bigger fonts so text stays readable when scaled to ~360px
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 600;
  const W = isMobile ? 500 : 780;
  const H = isMobile ? 320 : 260;
  const padL = isMobile ? 50 : 56;
  const padR = isMobile ? 16 : 24;
  const padT = isMobile ? 50 : 42;
  const padB = isMobile ? 44 : 38;
  const fsAxis = isMobile ? 16 : 10;       // y-axis labels
  const fsYear = isMobile ? 17 : 10;       // year labels under bars
  const fsValue = isMobile ? 15 : 9;       // value labels above bars
  const fsPill = isMobile ? 13 : 9;        // YoY pill text
  const pillH = isMobile ? 22 : 14;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  if (!years.length) {
    return '<div style="padding:40px 20px;text-align:center;color:var(--ink-muted);font-size:13px"><div style="font-family:Instrument Serif,serif;font-style:italic;font-size:15px;color:var(--ink-3);margin-bottom:6px">sem dados ainda</div>adicione anos no historico para ver o grafico</div>';
  }
  const maxData = Math.max(...values, 0);
  const yMax = (maxData > 0 ? maxData * 1.18 : 1);
  const barSlot = innerW / years.length;
  const barWidth = Math.min(barSlot * 0.55, isMobile ? 44 : 38);
  const currentYearActual = new Date().getFullYear();
  const gradId = opts.gradId || 'barGradPurple';
  const gradIdCurrent = opts.gradIdCurrent || 'barGradPink';
  const uniqueId = Math.random().toString(36).substr(2, 6);
  const gid = gradId + uniqueId;
  const gidC = gradIdCurrent + uniqueId;

  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;height:auto;max-width:100%">';
  svg += '<defs>';
  svg += '<linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">';
  svg += '<stop offset="0%" stop-color="#a855f7" stop-opacity="0.95"/>';
  svg += '<stop offset="100%" stop-color="#7c3aed" stop-opacity="0.65"/>';
  svg += '</linearGradient>';
  svg += '<linearGradient id="' + gidC + '" x1="0" y1="0" x2="0" y2="1">';
  svg += '<stop offset="0%" stop-color="#ec4899" stop-opacity="1"/>';
  svg += '<stop offset="100%" stop-color="#a855f7" stop-opacity="0.7"/>';
  svg += '</linearGradient>';
  svg += '<filter id="glowB' + uniqueId + '" x="-50%" y="-50%" width="200%" height="200%">';
  svg += '<feGaussianBlur stdDeviation="3" result="b"/>';
  svg += '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>';
  svg += '</filter>';
  svg += '</defs>';

  // Grid horizontal
  for (let i = 0; i <= 4; i++) {
    const y = padT + (innerH * i / 4);
    svg += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="rgba(255,255,255,0.05)" stroke-width="1" stroke-dasharray="2 4"/>';
    const val = yMax * (4 - i) / 4;
    svg += '<text x="' + (padL - 10) + '" y="' + (y + 4) + '" text-anchor="end" fill="#7d6e96" font-family="Geist Mono,monospace" font-size="' + fsAxis + '" font-weight="600">' + shortMoney(val) + '</text>';
  }

  // Bars
  years.forEach((y, i) => {
    const v = values[i] || 0;
    if (v <= 0) {
      // Empty year - draw label only
      const x = padL + barSlot * i + barSlot / 2;
      svg += '<text x="' + x + '" y="' + (H - 14) + '" text-anchor="middle" fill="#4d4063" font-family="Geist Mono,monospace" font-size="' + fsYear + '" font-weight="600">' + y + '</text>';
      return;
    }
    const barH = (v / yMax) * innerH;
    const x = padL + barSlot * i + (barSlot - barWidth) / 2;
    const barY = padT + innerH - barH;
    const isCurrent = y === currentYearActual;
    const fillUrl = isCurrent ? 'url(#' + gidC + ')' : 'url(#' + gid + ')';
    const yearColor = isCurrent ? '#c084fc' : '#7d6e96';
    const yearWeight = isCurrent ? '700' : '600';
    const yearLabel = isCurrent ? y + '*' : String(y);

    svg += '<rect x="' + x + '" y="' + barY + '" width="' + barWidth + '" height="' + barH + '" rx="5" fill="' + fillUrl + '"' + (isCurrent ? ' filter="url(#glowB' + uniqueId + ')"' : '') + '><title>' + y + ': ' + fmtBRL0(v) + '</title></rect>';
    // Value label above bar
    const valColor = isCurrent ? '#f472b6' : '#b8a8d4';
    svg += '<text x="' + (x + barWidth / 2) + '" y="' + (barY - (isMobile ? 10 : 6)) + '" text-anchor="middle" fill="' + valColor + '" font-family="Geist Mono,monospace" font-size="' + fsValue + '" font-weight="700">' + shortMoney(v) + '</text>';
    // Year label below
    svg += '<text x="' + (x + barWidth / 2) + '" y="' + (H - 14) + '" text-anchor="middle" fill="' + yearColor + '" font-family="Geist Mono,monospace" font-size="' + fsYear + '" font-weight="' + yearWeight + '">' + yearLabel + '</text>';
  });

  // ========================================================
  // YoY indicators - mode 'pills' or 'line'
  // ========================================================
  const yoyMode = opts.yoyMode || 'none';
  if (yoyMode !== 'none' && years.length >= 2) {
    // Compute bar centers and tops for pairs where both values > 0
    const points = [];
    for (let i = 0; i < years.length; i++) {
      const v = values[i] || 0;
      if (v <= 0) { points.push(null); continue; }
      const barH = (v / yMax) * innerH;
      const cx = padL + barSlot * i + barSlot / 2;
      const top = padT + innerH - barH;
      points.push({ cx, top, v, year: years[i] });
    }

    if (yoyMode === 'pills') {
      // v8 Turno 9 — Option C: dashed connector between bar tops + opaque pill in middle
      const firstVisibleIdx = opts.firstYoYIdx ?? 1;
      for (let i = firstVisibleIdx; i < points.length; i++) {
        const prev = points[i-1], cur = points[i];
        if (!prev || !cur || prev.v <= 0) continue;
        const yoy = ((cur.v - prev.v) / prev.v) * 100;
        if (!isFinite(yoy) || Math.abs(yoy) > 1000) continue;
        const sign = yoy >= 0 ? '+' : '';
        const txt = sign + yoy.toFixed(0) + '%';
        // v8 color: green <100%, amber >100%, red negative
        let bg, strokeCol;
        if (yoy < 0) { bg = '#ff5e57'; strokeCol = 'rgba(255,94,87,.3)'; }
        else if (yoy > 100) { bg = '#e3b974'; strokeCol = 'rgba(227,185,116,.3)'; }
        else { bg = '#34e17a'; strokeCol = 'rgba(52,225,122,.3)'; }
        // Dashed connector line between the two bar tops (from right edge of prev to left edge of cur)
        const prevRight = prev.cx + barWidth / 2;
        const curLeft = cur.cx - barWidth / 2;
        svg += '<line x1="' + prevRight + '" y1="' + prev.top + '" x2="' + curLeft + '" y2="' + cur.top + '" stroke="rgba(227,162,238,.35)" stroke-width="1.5" stroke-dasharray="2 3"/>';
        // Pill centered on midpoint of the connector, opaque fill
        const midX = (prev.cx + cur.cx) / 2;
        const midY = (prev.top + cur.top) / 2;
        const pillW = txt.length * (isMobile ? 8 : 6) + (isMobile ? 14 : 10);
        const pillTop = midY - pillH / 2;
        svg += '<g><rect x="' + (midX - pillW/2) + '" y="' + pillTop + '" width="' + pillW + '" height="' + pillH + '" rx="' + (pillH/2) + '" fill="' + bg + '" stroke="' + strokeCol + '" stroke-width="1"/>';
        svg += '<text x="' + midX + '" y="' + (pillTop + pillH * 0.72) + '" text-anchor="middle" fill="#1a181d" font-family="Geist Mono,monospace" font-size="' + fsPill + '" font-weight="700">' + txt + '</text></g>';
      }
    } else if (yoyMode === 'line') {
      // Connected polyline over bar tops + dots
      const valid = points.filter(p => p !== null);
      if (valid.length >= 2) {
        const linePts = valid.map(p => p.cx + ',' + p.top).join(' ');
        svg += '<polyline points="' + linePts + '" fill="none" stroke="#E3A2EE" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>';
        for (const p of valid) {
          svg += '<circle cx="' + p.cx + '" cy="' + p.top + '" r="4" fill="#E3A2EE" stroke="#29262B" stroke-width="2"/>';
        }
        // Show YoY % only on top 3 highest growths to avoid clutter
        const yoys = [];
        for (let i = 1; i < valid.length; i++) {
          const yoy = ((valid[i].v - valid[i-1].v) / valid[i-1].v) * 100;
          yoys.push({ idx: i, yoy, p: valid[i] });
        }
        yoys.sort((a, b) => Math.abs(b.yoy) - Math.abs(a.yoy));
        const topYoys = yoys.slice(0, 3);
        for (const y of topYoys) {
          const sign = y.yoy >= 0 ? '+' : '';
          const col = y.yoy >= 0 ? '#34e17a' : '#ff5e57';
          svg += '<text x="' + y.p.cx + '" y="' + (y.p.top - 10) + '" text-anchor="middle" fill="' + col + '" font-family="Geist Mono,monospace" font-size="' + fsValue + '" font-weight="700">' + sign + y.yoy.toFixed(0) + '%</text>';
        }
      }
    }
  }

  svg += '</svg>';
  return '<div style="width:100%;overflow:visible">' + svg + '</div>';
}

function renderDividendsChart() {
  const wrap = $('divChartWrap');
  if (!wrap) return;
  const currentYear = new Date().getFullYear();
  // Only show YEARS WITH DATA (history) + current year YTD if there's i10 sync
  const histYears = [...state.yearly]
    .filter(y => Number.isFinite(+y.year) && (+y.divs || 0) > 0)
    .sort((a, b) => a.year - b.year);

  const years = histYears.map(y => y.year);
  const values = histYears.map(y => +y.divs || 0);

  // Add current year (YTD) if not in history yet and has value
  if (!years.includes(currentYear) && (state.i10.dividends || 0) > 0) {
    years.push(currentYear);
    values.push(+state.i10.dividends || 0);
  }

  // Need at least 1 year
  if (years.length === 0) {
    wrap.innerHTML = '<div style="padding:40px 20px;text-align:center;color:var(--ink-muted);font-size:13px"><div style="font-family:Instrument Serif,serif;font-style:italic;font-size:15px;color:var(--ink-3);margin-bottom:6px">sem historico ainda</div>sincronize com I10 ou adicione anos manualmente</div>';
    return;
  }

  // v8 Turno 6: apply range filter before drawing
  const _filtered = filterByRange(years, values, window.chartRange || '5Y');
  wrap.innerHTML = buildBarChart(_filtered.years, _filtered.values, { yoyMode: 'pills', firstYoYIdx: 1 });
}

// Patrimônio (net worth) de fim de ano — fonte canônica dos anos antigos.
// A API do I10 NÃO expõe equity histórico pra carteira nova (2814459):
// /i10/yearly devolve equity:null em todo ano (confirmado). Esses são os
// valores reais do histórico do William, embutidos aqui pra serem
// resilientes: nenhum sync/import consegue apagá-los (o Firestore só é
// usado se tiver um valor > 0, então edições manuais ainda têm prioridade).
// Pra ajustar um ano: editar pelo botão "+ Year" no app (vence este mapa).
// Valores REAIS de fim de ano (dezembro) extraídos do barchart do I10
// (/summary/barchart/2814459/120/all, sum_equity do mês 12 de cada ano).
// Fallback caso o Firestore esteja vazio — mas o ideal é o "I10" import
// gravar esses mesmos números (o worker já puxa o barchart de 120 meses).
const HISTORICAL_EQUITY = {
  2020: 21175,
  2021: 64175,
  2022: 66339,
  2023: 293344,
  2024: 612610,
  2025: 1260018,
};
// Year-end equity DERIVED live from the I10 barchart (state.i10.monthly):
// the latest month seen for a given year (Dec, or the most recent). When
// /i10/all returns the long (120-month) barchart, this covers every year
// straight from I10 — no Firestore write, nothing to wipe.
function derivedYearEndEquity(year) {
  const m = state.i10.monthly || [];
  let best = null;
  for (const row of m) {
    if (+row.year === +year && (!best || +row.month > +best.month)) best = row;
  }
  return best ? (+best.equity || 0) : 0;
}
// Resolve year-end equity with precedence:
//   1. manual Firestore value (user edited via "+ Year") — always wins
//   2. live value derived from the I10 barchart
//   3. hardcoded historical fallback (offline / I10 unreachable)
function yearEquity(y) {
  const fs = +y.equity;
  if (Number.isFinite(fs) && fs > 0) return fs;
  const d = derivedYearEndEquity(+y.year);
  if (d > 0) return d;
  return HISTORICAL_EQUITY[+y.year] || 0;
}

function renderPLChart() {
  const wrap = $('plChartWrap');
  if (!wrap) return;
  const currentYear = new Date().getFullYear();
  const sortedYearly = [...state.yearly]
    .map(y => ({ ...y, _eq: yearEquity(y) }))
    .filter(y => Number.isFinite(+y.year) && y._eq > 0)
    .sort((a, b) => a.year - b.year);

  if (sortedYearly.length === 0 && (!state.i10.equity || state.i10.equity <= 0)) {
    wrap.innerHTML = '<div style="padding:40px 20px;text-align:center;color:var(--ink-muted);font-size:13px"><div style="font-family:Instrument Serif,serif;font-style:italic;font-size:15px;color:var(--ink-3);margin-bottom:6px">sem historico de PL</div>sincronize com I10 para ver a evolucao</div>';
    return;
  }

  const years = sortedYearly.map(y => y.year);
  const values = sortedYearly.map(y => y._eq);

  // Add or override current year with i10 value (always fresher)
  const hasCurrent = years.includes(currentYear);
  if (!hasCurrent && state.i10.equity > 0) {
    years.push(currentYear);
    values.push(state.i10.equity);
  } else if (hasCurrent && state.i10.equity > 0) {
    const idx = years.indexOf(currentYear);
    values[idx] = state.i10.equity;
  }

  // v8 Turno 6: apply range filter before drawing
  const _filtered = filterByRange(years, values, window.chartRange || '5Y');
  wrap.innerHTML = buildBarChart(_filtered.years, _filtered.values, { yoyMode: 'pills', firstYoYIdx: 1 });
}

function renderYearlyTable() {
  const tbody = $('yearlyBody');
  const sorted = [...state.yearly].sort((a,b) => (a.year||0) - (b.year||0));
  if (sorted.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-table"><h4>No yearly data</h4><p>Click "+ Year" to add your first year.</p></div></td></tr>`;
    return;
  }
  // v8 Turno 4: compact values (64,2K / 1,34M) + sanitized YoY (>1000% → —)
  const compact = (n) => {
    const abs = Math.abs(n || 0);
    if (abs >= 1_000_000) return (n/1_000_000).toFixed(2).replace('.', ',') + 'M';
    if (abs >= 1_000)     return (n/1_000).toFixed(1).replace('.', ',') + 'K';
    return String(Math.round(n || 0));
  };
  tbody.innerHTML = sorted.map((y, i) => {
    const eq = yearEquity(y); // Firestore value if present, else historical fallback
    const dy = (eq > 0) ? ((+y.divs / eq) * 100).toFixed(1) + '%' : '—';
    let yoy = '—';
    if (i > 0) {
      const prev = +sorted[i-1].divs || 0;
      if (prev > 0) {
        const growth = (((+y.divs || 0) - prev) / prev) * 100;
        if (isFinite(growth) && Math.abs(growth) <= 1000) {
          yoy = (growth >= 0 ? '+' : '') + growth.toFixed(1) + '%';
        }
      }
    }
    const yoyClass = yoy.startsWith('+') ? 'pos' : (yoy.startsWith('-') ? 'neg' : '');
    return `<tr data-id="${y.id}"><td>${y.year}</td><td>${compact(eq)}</td><td>${compact(+y.divs||0)}</td><td>${dy}</td><td class="${yoyClass}">${yoy}</td></tr>`;
  }).join('');
  tbody.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', () => openYearlyModal(tr.dataset.id)));
}

// ============================================================
//                I10 AUTO-SYNC (via Cloudflare Worker)
// ============================================================
// ============================================================
//  Categoria inference (Brazilian market)
// ============================================================
const FII_WHITELIST = new Set([
  'HGLG11','MXRF11','KNRI11','XPLG11','BCFF11','VISC11','HGRE11','KNCR11','VRTA11','BTLG11',
  'IRDM11','RBRR11','RECT11','HGRU11','RZAK11','HFOF11','BBPO11','PVBI11','HGCR11','DEVA11',
  'KNHY11','MALL11','BTCR11','RBRF11','KFOF11','RBRP11','GGRC11','JSRE11','TRXF11','VINO11',
  'XPML11','RBVA11','VGIR11','XPCI11','HGBS11','VILG11','MGFF11','ALZR11','HSML11','PATC11',
  'CPTS11','MFII11','RVBI11','RBED11','RZTR11','HABT11','RCRB11','MCCI11','BPFF11','XPIN11',
  'OUJP11','BARI11','RBRY11','VGHF11','URPR11','VIUR11','VIFI11','LVBI11','SARE11','PORD11',
]);

const ETF_BR_WHITELIST = new Set([
  'BOVA11','SMAL11','BOVV11','XBOV11','DIVO11','ECOO11','PIBB11','FIND11','GOVE11','ISUS11',
  'MATB11','MOBI11','SMAC11','BBSD11','HASH11','BDIF11','BRAX11','SPXB11','XINA11',
]);

const ETF_INTL_WHITELIST = new Set([
  'IVVB11','SPXI11','NASD11','ACWI11','EURP11','ASIA11','GOLD11','WRLD11','XFIX11','ASHR11',
]);

const CRYPTO_WHITELIST = new Set([
  'BTC','ETH','SOL','ADA','XRP','BNB','DOGE','MATIC','DOT','LINK','LTC','BCH','XLM','TRX',
  'UNI','ATOM','AVAX','NEAR','SHIB','PEPE','BTC11','ETHE11','BITH11',
]);

// Map ticker -> category populated from /i10/diversification (real data from I10)
let _i10TickerCategory = {};

function inferCategory(asset) {
  // 1. trust explicit field if present
  if (asset.category) return asset.category;
  if (asset.type) return asset.type;

  const t = (asset.ticker || '').toUpperCase().trim();
  if (!t) return 'Outros';

  // 2. use real category from /i10/diversification if available
  if (_i10TickerCategory[t]) return _i10TickerCategory[t];

  // 3. fallback regex/whitelist
  if (CRYPTO_WHITELIST.has(t) || /^(BTC|ETH)/.test(t)) return 'Criptomoedas';
  if (/^TESOURO|^LFT|^LTN|^NTN/.test(t)) return 'Tesouro Direto';
  if (ETF_INTL_WHITELIST.has(t)) return 'ETFs Internacionais';
  if (ETF_BR_WHITELIST.has(t)) return 'ETFs Brasil';
  if (FII_WHITELIST.has(t)) return 'FIIs';
  if (/CDB|LCI|LCA|DEBENT/.test(t)) return 'Renda Fixa';
  if (/FIA$|FIM$|FIC$|FUNDO/.test(t)) return 'Fundos de Investimento';

  // Default for stock-like patterns (XXXX3, XXXX4, XXXX11 unknown)
  if (/^[A-Z]{4}[0-9]{1,2}$/.test(t)) return 'Acoes';

  return 'Outros';
}

const CATEGORY_ORDER = ['Acoes','FIIs','Renda Fixa','Tesouro Direto','Fundos de Investimento','ETFs Brasil','ETFs Internacionais','BDRs','Criptomoedas','Outros'];

// Normalize any category label (from I10_TYPE_TO_CAT, inferCategory, legacy
// data, accented or not) to a canonical CATEGORY_ICONS/_DISPLAY/_ORDER key.
function canonicalCategory(label) {
  const s = (label || '').toString().trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, ''); // strip accents
  if (!s) return 'Outros';
  if (/internacion/.test(s)) return 'ETFs Internacionais';
  if (/etf/.test(s)) return 'ETFs Brasil';
  if (/fii|imobiliar/.test(s)) return 'FIIs';
  if (/tesouro/.test(s)) return 'Tesouro Direto';
  if (/renda\s*fixa|cdb|lci|lca|debent|fixed/.test(s)) return 'Renda Fixa';
  if (/cripto|crypto|bitcoin|btc/.test(s)) return 'Criptomoedas';
  if (/bdr/.test(s)) return 'BDRs';
  if (/fundo|fund/.test(s)) return 'Fundos de Investimento';
  if (/aco|acao|acoes|stock|ticker|^acoes$/.test(s)) return 'Acoes';
  return 'Outros';
}

const CATEGORY_ICONS = {
  'Acoes':                   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><polyline points="7 14 11 10 15 14 19 10"/></svg>',
  'FIIs':                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l8-4 8 4v14"/><path d="M9 9h1m4 0h1m-6 4h1m4 0h1m-6 4h1m4 0h1"/></svg>',
  'Renda Fixa':              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="7" y1="15" x2="9" y2="15"/></svg>',
  'Tesouro Direto':          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 5v8l-8 5-8-5V8z"/><path d="M12 3v18"/></svg>',
  'Fundos de Investimento':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
  'ETFs Brasil':             '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
  'ETFs Internacionais':     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
  'Criptomoedas':            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9 8h4.5a2.5 2.5 0 0 1 0 5H9V8zm0 5h5a2.5 2.5 0 0 1 0 5H9v-5z"/></svg>',
  'BDRs':                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10"/><path d="M12 2a15.3 15.3 0 0 0-4 10 15.3 15.3 0 0 0 4 10"/></svg>',
  'Outros':                  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
};

const CATEGORY_DISPLAY = {
  'Acoes': 'Acoes',
  'FIIs': 'FIIs',
  'Renda Fixa': 'Renda Fixa',
  'Tesouro Direto': 'Tesouro Direto',
  'Fundos de Investimento': 'Fundos de Invest.',
  'ETFs Brasil': 'ETFs Brasil',
  'ETFs Internacionais': 'ETFs Intern.',
  'Criptomoedas': 'Criptomoedas',
  'BDRs': 'BDRs',
  'Outros': 'Outros',
};

let _expandedCats = new Set(['Acoes']); // Acoes expanded by default

function renderI10Assets() {
  const wrap = $('i10AssetsList');
  if (!wrap) return;
  const assets = state.i10.assets || [];

  if (assets.length === 0) {
    wrap.innerHTML = '<div style="padding:30px 10px;color:var(--ink-muted);text-align:center;font-size:13px"><b style="color:var(--ink-2);display:block;margin-bottom:6px">Nenhum ativo sincronizado</b>Clique em "Sincronizar" pra importar sua carteira do Investidor 10.</div>';
    // Still append USD/reserves/pension below.
  }

  // Group every asset by its canonical category (derived from the
  // per-asset `.category` set in syncFromI10). This no longer depends on
  // the absent `diversification` payload — it works straight off the
  // assets list, so all classes (Ações, Tesouro, FIIs, ETFs, etc.) show.
  const groups = {}; // canonKey -> { value, items: [] }
  let assetsTotal = 0;
  assets.forEach(a => {
    const key = canonicalCategory(a.category);
    if (!groups[key]) groups[key] = { value: 0, items: [] };
    const eq = +a.equity || 0;
    groups[key].value += eq;
    groups[key].items.push(a);
    assetsTotal += eq;
  });

  const sortedKeys = Object.keys(groups).sort((ka, kb) => {
    const ia = CATEGORY_ORDER.indexOf(ka);
    const ib = CATEGORY_ORDER.indexOf(kb);
    if (ia !== ib) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    return groups[kb].value - groups[ka].value;
  });

  const html = sortedKeys.map(key => {
    const g = groups[key];
    const label = CATEGORY_DISPLAY[key] || key;
    const icon = CATEGORY_ICONS[key] || CATEGORY_ICONS['Outros'] || '';
    const pct = assetsTotal > 0 ? (g.value / assetsTotal) * 100 : 0;
    const n = g.items.length;
    const countStr = n + ' ' + (n === 1 ? t('cat.assets.singular') : t('cat.assets.plural'));
    const chevronHtml = '<svg class="cat-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

    const sortedTickers = [...g.items].sort((a, b) => (+b.equity || 0) - (+a.equity || 0));
    const tickersHtml = sortedTickers.map(a => {
      const appr = +a.appreciation || 0;
      const cls = appr >= 0 ? 'pos' : 'neg';
      const sign = appr >= 0 ? '+' : '';
      return '<div class="ticker-row"><div class="ticker-name">' + esc(a.ticker || '-') + '</div><div class="ticker-val">' + fmtBRL0(+a.equity || 0) + '</div><div class="ticker-appr ' + cls + '">' + sign + appr.toFixed(1) + '%</div></div>';
    }).join('');

    const expanded = _expandedCats.has(key) ? ' expanded' : '';
    return '<div class="cat-row clickable' + expanded + '" data-type="' + esc(key) + '">' +
      '<div class="cat-icon">' + icon + '</div>' +
      '<div class="cat-info">' +
        '<div class="cat-name">' + esc(label) + '</div>' +
        '<div class="cat-count">' + countStr + ' &middot; ' + pct.toFixed(0) + '% ' + t('cat.label.suffix') + '</div>' +
      '</div>' +
      '<div>' +
        '<div class="cat-value">' + fmtBRL0(g.value) + '</div>' +
      '</div>' +
      '<div class="cat-appr"></div>' +
      chevronHtml +
    '</div>' +
    '<div class="cat-tickers">' + tickersHtml + '</div>';
  }).join('');

  wrap.innerHTML = html;

  // v8 Turno 8 — append USD row to portfolio list
  const usd = +state.fx.usd || 0;
  const rate = +state.fx.rateUSD || 0;
  if (usd > 0 && rate > 0) {
    const usdBRL = usd * rate;
    const totalWallet = (+state.i10.equity || 0) + usdBRL;
    const percent = totalWallet > 0 ? (usdBRL / totalWallet) * 100 : 0;
    const rateStr = rate.toFixed(2).replace('.', ',');
    const usdRowHTML = '<div class="cat-row fx-row" id="fxCatRow">' +
      '<div class="cat-icon fx-icon">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 1 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>' +
      '</div>' +
      '<div class="cat-info">' +
        '<div class="cat-name">USD</div>' +
        '<div class="cat-count">' + percent.toFixed(0) + '% ' + t('cat.label.suffix') + '</div>' +
        '<div class="fx-extra"><span class="fx-native">US$ ' + usd.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '</span><span class="fx-rate-chip">× ' + rateStr + '</span></div>' +
      '</div>' +
      '<div>' +
        '<div class="cat-value">R$ ' + usdBRL.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + '</div>' +
      '</div>' +
      '<button class="fx-edit-btn" id="fxEditBtn" type="button" aria-label="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>' +
    '</div>';
    wrap.insertAdjacentHTML('beforeend', usdRowHTML);
  } else {
    // No holding yet: small "add" hint at the end
    const addRowHTML = '<button class="fx-add-hint" id="fxEditBtn" type="button">+ Adicionar USD</button>';
    wrap.insertAdjacentHTML('beforeend', addRowHTML);
  }
  const fxBtn = document.getElementById('fxEditBtn');
  if (fxBtn) fxBtn.addEventListener('click', openFXModal);

  // Reserves row (always visible per spec)
  renderReservesRow(wrap);

  // Pension row (always visible — same UX pattern)
  renderCashRow('pension', wrap);

  // Wire expand/collapse only for Ações (reserves row has its own handler)
  wrap.querySelectorAll('.cat-row.clickable').forEach(row => {
    if (row.id === 'reserveRow') return;
    if (row.id === 'pensionRow') return;
    row.addEventListener('click', () => {
      const open = row.classList.toggle('expanded');
      // Persist expand state per category so a re-render (e.g. auto-sync)
      // doesn't collapse what the user opened.
      const key = row.dataset.type;
      if (key) { if (open) _expandedCats.add(key); else _expandedCats.delete(key); }
    });
  });
}

// ============================================================
//  MONTHLY RETURNS (rentabilidade mês a mês)
// ============================================================
const MONTH_NAMES_SHORT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const MONTH_NAMES_SHORT_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function renderMonthlyReturns() {
  const svg = document.getElementById('mrChart');
  const wrap = document.getElementById('mrChartWrap');
  const tbody = document.getElementById('mrTableBody');
  const empty = document.getElementById('mrEmpty');
  const badge = document.getElementById('mrReturnBadge');
  if (!svg || !tbody) return;

  // The barchart may now carry the full 10-year history (120 months);
  // this card only wants the recent run, so slice to the last 13 months
  // (→ 12 monthly returns). The full series still feeds yearEquity().
  const recentMonthly = (state.i10.monthly || []).slice(-13);
  const rows = computeMonthlyReturns(recentMonthly, state.contributions || [], state.yearly || []);
  if (rows.length === 0) {
    wrap.style.display = 'none';
    if (empty) {
      empty.hidden = false;
      empty.innerHTML = `<p>${t('mr.empty')}</p>`;
    }
    tbody.innerHTML = '';
    if (badge) badge.hidden = true;
    return;
  }
  wrap.style.display = '';
  if (empty) empty.hidden = true;

  // --- Chart ---
  const W = 700, H = 200, PAD_X = 28, PAD_BOTTOM = 28, PAD_TOP = 14;
  const slot = (W - PAD_X * 2) / rows.length;
  const barW = Math.max(10, slot - 8);
  const mid = H - PAD_BOTTOM - (H - PAD_BOTTOM - PAD_TOP) / 2; // vertical center = 0%
  const maxAbs = Math.max(2, ...rows.map(r => Math.abs(r.returnPct))); // min 2% to avoid flat vis
  const halfPlot = (H - PAD_BOTTOM - PAD_TOP) / 2;
  const yAt = (pct) => mid - (pct / maxAbs) * halfPlot;
  const monthNames = getLang() === 'en' ? MONTH_NAMES_SHORT_EN : MONTH_NAMES_SHORT;

  const bars = rows.map((r, i) => {
    const x = PAD_X + i * slot + (slot - barW) / 2;
    const pct = r.returnPct;
    const y = pct >= 0 ? yAt(pct) : mid;
    const h = Math.abs(yAt(pct) - mid);
    const color = pct >= 0 ? 'var(--gain)' : 'var(--loss)';
    const labelY = H - PAD_BOTTOM + 14;
    const monthChar = monthNames[r.month - 1];
    const valLabelY = pct >= 0 ? (y - 4) : (y + h + 10);
    const valText = (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" fill="${color}" opacity="0.85" rx="2"><title>${monthChar}/${String(r.year).slice(-2)}: ${valText}</title></rect>
      <text x="${(x + barW/2).toFixed(1)}" y="${valLabelY.toFixed(1)}" text-anchor="middle" fill="${color}" font-size="9.5" font-family="'Geist Mono', monospace" font-weight="600" opacity="0.85">${valText}</text>
      <text x="${(x + barW/2).toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" fill="var(--ink-muted)" font-size="10" font-family="'Geist Mono', monospace">${monthChar}</text>`;
  }).join('');

  // Zero baseline
  const baseline = `<line x1="${PAD_X.toFixed(1)}" y1="${mid.toFixed(1)}" x2="${(W - PAD_X).toFixed(1)}" y2="${mid.toFixed(1)}" stroke="var(--ink-muted)" stroke-width="0.5" stroke-dasharray="3 4" opacity="0.4"/>`;

  svg.innerHTML = baseline + bars;

  // Badge: average of last N (max 12)
  if (badge) {
    const lastN = rows.slice(-12);
    const avg = lastN.reduce((s, r) => s + r.returnPct, 0) / lastN.length;
    badge.hidden = false;
    badge.className = 'mr-badge ' + (avg >= 0 ? 'pos' : 'neg');
    badge.textContent = t('mr.avg').replace('{pct}', (avg >= 0 ? '+' : '') + avg.toFixed(1) + '%').replace('{n}', lastN.length);
  }

  // --- Table ---
  tbody.innerHTML = [...rows].reverse().map(r => {
    const pctCls = r.returnPct >= 0 ? 'pos' : 'neg';
    const brlCls = r.returnBRL >= 0 ? 'pos' : 'neg';
    const monthChar = monthNames[r.month - 1];
    return `<tr>
      <td class="mono mr-td-month">${monthChar}/${String(r.year).slice(-2)}</td>
      <td class="mono mr-num">${fmtBRL0(r.start)}</td>
      <td class="mono mr-num">${fmtBRL0(r.end)}</td>
      <td class="mono mr-num">${r.contrib > 0 ? fmtBRL0(r.contrib) : '—'}</td>
      <td class="mono mr-num">${r.dividends > 0 ? fmtBRL0(r.dividends) : '—'}</td>
      <td class="mono mr-num ${brlCls}">${(r.returnBRL >= 0 ? '+' : '') + fmtBRL0(r.returnBRL)}</td>
      <td class="mono mr-num ${pctCls}">${(r.returnPct >= 0 ? '+' : '') + r.returnPct.toFixed(2)}%</td>
    </tr>`;
  }).join('');
}

// ============================================================
//  CONTRIBUTIONS (aportes mensais em dinheiro)
// ============================================================

function renderContributions() {
  const wrap = document.getElementById('contribList');
  const totalEl = document.getElementById('contribTotal');
  const avgEl = document.getElementById('contribAvg');
  if (!wrap) return;

  const items = [...(state.contributions || [])];

  if (items.length === 0) {
    wrap.innerHTML = '<div style="padding:24px 10px;color:var(--ink-muted);text-align:center;font-size:13px">Nenhum aporte cadastrado. Clique em "+ Aporte" para comecar.</div>';
    if (totalEl) totalEl.textContent = 'R$ 0';
    if (avgEl) avgEl.textContent = 'R$ 0';
    return;
  }

  // Group by year-month
  const groups = {};
  for (const c of items) {
    const key = `${c.year}-${String(c.month).padStart(2,'0')}`;
    if (!groups[key]) groups[key] = { year: c.year, month: c.month, items: [], total: 0 };
    groups[key].items.push(c);
    groups[key].total += +c.amount || 0;
  }

  const sortedGroups = Object.values(groups).sort((a, b) => {
    return (b.year * 100 + b.month) - (a.year * 100 + a.month);
  });

  const total = items.reduce((s, c) => s + (+c.amount || 0), 0);
  const monthsCount = sortedGroups.length;
  const avg = monthsCount > 0 ? total / monthsCount : 0;
  if (totalEl) totalEl.textContent = fmtBRL0(total);
  if (avgEl) avgEl.textContent = fmtBRL0(avg);

  wrap.innerHTML = sortedGroups.map(g => {
    const monthLbl = MONTH_NAMES_SHORT[(g.month || 1) - 1] || '?';
    const countBadge = g.items.length > 1
      ? `<span style="display:inline-block;padding:2px 7px;background:var(--purple-soft);color:var(--purple-light);border-radius:999px;font-size:9px;font-weight:700;margin-left:6px;font-family:'Geist Mono',monospace">${g.items.length}</span>`
      : '';
    // Single-contribution months show their note inline; multi-month rows
    // just show the count badge (notes visible in the detail modal).
    const note = (g.items.length === 1 && g.items[0].note) ? g.items[0].note : '';
    const noteHtml = note ? `<div class="contrib-row-note">${esc(note)}</div>` : '';
    return `<div class="ticker-row" data-key="${g.year}-${g.month}" style="cursor:pointer">
      <div class="ticker-name">${monthLbl}/${g.year || '?'}${countBadge}${noteHtml}</div>
      <div class="ticker-val">${fmtBRL0(g.total)}</div>
      <div class="ticker-appr pos">aporte</div>
    </div>`;
  }).join('');

  wrap.querySelectorAll('.ticker-row').forEach(row => {
    row.addEventListener('click', () => {
      const [y, m] = row.dataset.key.split('-').map(Number);
      openContribListModal(y, m);
    });
  });
}

let _editingContribId = null;
let _editingMonth = null;

function openContribListModal(year, month) {
  _editingMonth = { year, month };
  const modal = document.getElementById('contribListModal');
  if (!modal) return;

  const monthLbl = MONTH_NAMES_SHORT[(month || 1) - 1] || '?';
  document.getElementById('contribListTitle').textContent = `${monthLbl}/${year}`;

  const items = (state.contributions || []).filter(c => c.year === year && c.month === month)
    .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));

  const total = items.reduce((s, c) => s + (+c.amount || 0), 0);
  document.getElementById('contribListTotal').textContent = fmtBRL0(total) + ' total · ' + items.length + ' ' + (items.length === 1 ? 'aporte' : 'aportes');

  const listEl = document.getElementById('contribListItems');
  listEl.innerHTML = items.map(c => `
    <div class="contrib-item" data-id="${c.id}">
      <div class="contrib-val">${fmtBRL0(+c.amount || 0)}${c.note ? `<span class="contrib-note">${esc(c.note)}</span>` : ''}</div>
      <button class="contrib-edit" data-action="edit" data-id="${c.id}" title="Editar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
      </button>
      <button class="contrib-del" data-action="delete" data-id="${c.id}" title="Excluir">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `).join('');

  listEl.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (btn.dataset.action === 'edit') openContribModal(id);
      else if (btn.dataset.action === 'delete') deleteContribById(id);
    });
  });

  modal.classList.add('show');
}

function closeContribListModal() {
  document.getElementById('contribListModal')?.classList.remove('show');
  _editingMonth = null;
}

function openContribModal(id) {
  _editingContribId = id || null;
  const modal = document.getElementById('contribModal');
  if (!modal) return;
  if (id) {
    const c = state.contributions.find(x => x.id === id);
    if (c) {
      document.getElementById('contribYear').value = c.year || new Date().getFullYear();
      document.getElementById('contribMonth').value = c.month || (new Date().getMonth() + 1);
      document.getElementById('contribAmount').value = fmtBRLInput(c.amount);
      document.getElementById('contribNote').value = c.note || '';
      document.getElementById('contribDelete').style.display = 'inline-flex';
    }
  } else if (_editingMonth) {
    // Adding new to specific month from list modal
    document.getElementById('contribYear').value = _editingMonth.year;
    document.getElementById('contribMonth').value = _editingMonth.month;
    document.getElementById('contribAmount').value = '';
    document.getElementById('contribNote').value = '';
    document.getElementById('contribDelete').style.display = 'none';
  } else {
    const now = new Date();
    document.getElementById('contribYear').value = now.getFullYear();
    document.getElementById('contribMonth').value = now.getMonth() + 1;
    document.getElementById('contribAmount').value = '';
    document.getElementById('contribNote').value = '';
    document.getElementById('contribDelete').style.display = 'none';
  }
  modal.classList.add('show');
  setTimeout(() => document.getElementById('contribAmount').focus(), 50);
}

function closeContribModal() {
  document.getElementById('contribModal')?.classList.remove('show');
  _editingContribId = null;
}

async function saveContrib() {
  const year = parseInt(document.getElementById('contribYear').value, 10);
  const month = parseInt(document.getElementById('contribMonth').value, 10);
  const amount = parseBRLInput(document.getElementById('contribAmount').value);
  const note = (document.getElementById('contribNote')?.value || '').trim();
  if (!(year >= 2020 && year <= 2099)) { showToast('Ano inválido'); return; }
  if (!(month >= 1 && month <= 12)) { showToast('Mês inválido'); return; }
  if (!(amount > 0)) { showToast('Valor inválido'); return; }
  try {
    if (_editingContribId) {
      const ref = doc(db, 'household', 'main', 'contributions', _editingContribId);
      await setDoc(ref, { year, month, amount, note, updatedAt: serverTimestamp() }, { merge: true });
    } else {
      // Auto-generated ID - allows multiple contributions per month
      const colRef = collection(db, 'household', 'main', 'contributions');
      await addDoc(colRef, { year, month, amount, note, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: state.user?.displayName || 'unknown' });
    }
    showToast(t('toast.saved'));
    closeContribModal();
    // Refresh list modal if it was open
    if (_editingMonth) {
      setTimeout(() => openContribListModal(_editingMonth.year, _editingMonth.month), 100);
    }
  } catch (e) {
    console.error('saveContrib error', e);
    showToast(t('toast.error.save'));
  }
}

async function deleteContrib() {
  if (!_editingContribId) return;
  const id = _editingContribId;
  openConfirmModal({
    title: 'Excluir aporte?', sub: 'Esta ação não pode ser desfeita.',
    confirmLabel: 'Sim, excluir', danger: true,
    onConfirm: async () => {
      try {
        await deleteDoc(doc(db, 'household', 'main', 'contributions', id));
        showToast(t('toast.deleted'));
        closeContribModal();
        if (_editingMonth) {
          setTimeout(() => openContribListModal(_editingMonth.year, _editingMonth.month), 100);
        }
      } catch (e) { showToast(t('toast.error.delete')); }
    },
  });
}

async function deleteContribById(id) {
  openConfirmModal({
    title: 'Excluir aporte?', sub: 'Esta ação não pode ser desfeita.',
    confirmLabel: 'Sim, excluir', danger: true,
    onConfirm: async () => {
      try {
        await deleteDoc(doc(db, 'household', 'main', 'contributions', id));
        showToast(t('toast.deleted'));
        if (_editingMonth) {
          setTimeout(() => openContribListModal(_editingMonth.year, _editingMonth.month), 100);
        }
      } catch (e) { showToast(t('toast.error.delete')); }
    },
  });
}


// v8 Turno 7 — Louise wallet render
function renderLouise() {
  const chip = document.getElementById('louiseChip');
  const eq = $('louiseEquity');
  if (!eq) return;
  const equity = +state.i10Louise.equity || 0;
  // Hide chip entirely if there's no data yet
  if (chip) chip.style.display = equity > 0 ? 'inline-flex' : 'none';
  eq.textContent = 'R$ ' + equity.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  const divEl = $('louiseDividends');
  if (divEl) divEl.textContent = 'R$ ' + (state.i10Louise.dividends || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  const varEl = $('louiseVariation');
  if (varEl) {
    const v = +state.i10Louise.variation || 0;
    const sign = v >= 0 ? '+' : '';
    varEl.textContent = sign + v.toFixed(1) + '%';
    varEl.className = 'louise-chip-var ' + (v >= 0 ? 'gain' : 'loss');
  }
  const upd = $('louiseUpdated');
  if (upd) {
    upd.textContent = state.i10Louise.updatedAt
      ? t('hero.updated.prefix') + ' \u00b7 ' + formatDateTimeBR(state.i10Louise.updatedAt)
      : t('hero.updated.never');
  }
}

async function syncLouise() {
  const workerUrl = state.i10Cfg.workerUrl || '';
  const walletId = state.i10LouiseCfg.walletId;
  if (!workerUrl || !walletId) { console.warn('Louise sync skipped: workerUrl or walletId missing'); return; }
  try {
    const year = new Date().getFullYear();
    const base = workerUrl.replace(/\/+$/, '');
    const url = `${base}/i10/all/${encodeURIComponent(walletId)}?year=${year}`;
    console.log('Louise sync \u2192', url);
    const res = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    const m = payload.metrics || {};
    const equity = parseFloat(m.equity) || 0;
    const applied = parseFloat(m.applied) || 0;
    const variation = parseFloat(m.variation) || 0;
    const dividends = parseFloat(payload.earnings?.sum) || 0;
    await setDoc(docI10Louise, {
      equity, dividends, applied, variation, year,
      updatedAt: serverTimestamp(),
      updatedBy: (state.user?.displayName || 'unknown') + ' (auto)',
      source: 'investidor10-sync',
    }, { merge: true });
    console.log('Louise sync \u2713', { equity, dividends });
  } catch (err) {
    console.warn('Louise sync failed:', err);
  }
}

async function syncFromI10() {
  const { workerUrl, walletId } = state.i10Cfg;
  if (!workerUrl || !walletId) {
    showToast('Configure o Worker e Wallet ID primeiro');
    openI10ConfigModal();
    return;
  }
  if (state.i10Syncing) return;
  state.i10Syncing = true;
  const btn = $('btnSyncI10');
  const originalHTML = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = 'Sincronizando...'; }

  try {
    const year = new Date().getFullYear();
    const base = workerUrl.replace(/\/+$/, ''); // remove trailing slash
    // Fetch /i10/all (metrics + earnings + actives) in parallel with
    // /i10/barchart (12m equity history). The barchart endpoint has
    // been live on the worker since day 1 but never consumed; polling
    // it alongside /all avoids needing a worker redeploy just to add
    // a new field to /all. If /all ships a `barchart` field in the
    // future (worker.js already does this but needs redeploy), we
    // prefer it and skip the second request.
    let payload;
    const allUrl = `${base}/i10/all/${encodeURIComponent(walletId)}?year=${year}`;
    const barUrl = `${base}/i10/barchart/${encodeURIComponent(walletId)}`;
    const [allRes, barRes] = await Promise.all([
      fetch(allUrl, { method: 'GET', headers: { 'Accept': 'application/json' } }),
      fetch(barUrl, { method: 'GET', headers: { 'Accept': 'application/json' } }).catch(() => null),
    ]);
    if (!allRes.ok) throw new Error(`HTTP ${allRes.status}`);
    payload = await allRes.json();
    // If /all didn't include barchart (worker not yet redeployed), pull
    // it from the dedicated endpoint. Failure is non-fatal — monthly
    // returns card will just show its empty state.
    if (!payload.barchart && barRes && barRes.ok) {
      try { payload.barchart = await barRes.json(); }
      catch (e) { console.warn('[i10] barchart fetch parse failed:', e); }
    }

    // Parse metrics (equity, applied, variation, profit_twr)
    const m = payload.metrics || {};
    const equity = parseFloat(m.equity) || 0;
    const applied = parseFloat(m.applied) || 0;
    const variation = parseFloat(m.variation) || 0;
    const profitTwr = parseFloat(m.profit_twr) || 0;

    // Parse earnings (sum of dividends YTD)
    const dividends = parseFloat(payload.earnings?.sum) || 0;

    // Populate global ticker->category map from /i10/full diversification
    if (payload.diversification?.tickerToCategory) {
      _i10TickerCategory = payload.diversification.tickerToCategory;
    }

    // Parse diversification (categories summary from /patrimony/.../diversification/all,ideal-per-type)
    let categories = [];
    if (payload.diversification?.values && Array.isArray(payload.diversification.values)) {
      categories = payload.diversification.values.map(c => ({
        name: c.name || '',
        type: c.type || '',
        value: +c.value || 0,
        percent: +c.percent || 0,
      }));
    }

    // Parse barchart (12-month equity history). Shape is unknown across
    // I10 API versions; normalize to [{ year, month, equity }] sorted
    // ascending. Any failure here is non-fatal — we fall back to [].
    const monthly = parseI10Barchart(payload.barchart);

    // Parse actives (list of tickers)
    const rawAssets = Array.isArray(payload.actives?.data) ? payload.actives.data : [];
    // The worker now tags each row with `__assetClass` based on which
    // /summary/actives/<TYPE> endpoint it came from. Map that to a
    // human-friendly category label. Fallback to inferCategory() (the
    // ticker-based heuristic) for legacy/unexpected rows.
    const I10_TYPE_TO_CAT = {
      Ticker: 'Ações',
      TesouroDireto: 'Tesouro Direto',
      RendaFixa: 'Renda Fixa',
      Fii: 'FIIs',
      Etf: 'ETFs',
      Bdr: 'BDRs',
      FundoInvestimento: 'Fundos',
      Criptomoeda: 'Criptomoedas',
    };
    const assets = rawAssets.map(a => {
      const ticker = a.ticker || a.ticker_name || '';
      const tickerUpper = ticker.toUpperCase().trim();
      const fromType = a.__assetClass ? I10_TYPE_TO_CAT[a.__assetClass] : null;
      return {
        ticker,
        quantity: +a.quantity || 0,
        avgPrice: +a.avg_price || 0,
        currentPrice: parseFloat(a.current_price) || 0,
        equity: +a.equity_total || parseFloat(a.equity_brl) || 0,
        appreciation: +a.appreciation || 0,
        percentWallet: +a.percent_wallet || 0,
        earnings: +a.earnings_received || 0,
        image: a.image || '',
        url: a.url || '',
        category: fromType || inferCategory({ ticker }),
      };
    });

    // Persist in Firestore - both users share via onSnapshot
    await setDoc(docI10, {
      equity,
      dividends,
      applied,
      variation,
      profitTwr,
      assets,
      categories,
      monthly,
      year,
      updatedAt: serverTimestamp(),
      updatedBy: (state.user?.displayName || 'unknown') + ' (auto)',
      source: 'investidor10-sync',
    }, { merge: true });

    showToast(`Sincronizado: ${assets.length} ativos`);
    const _hc = document.querySelector('.hero-card');
    if (_hc) { _hc.classList.remove('sweeping'); void _hc.offsetWidth; _hc.classList.add('sweeping'); setTimeout(() => _hc.classList.remove('sweeping'), 1000); }
    // v8 Turno 7: piggyback Louise sync on every successful main sync (both branches)
    syncLouise().catch(e => console.warn('Louise piggyback error:', e));
    fetchFXRate().catch(e => console.warn('FX rate refresh error:', e));
    // Piggyback yearly history refresh — silent + throttled to 24h to
    // avoid hammering /i10/yearly (which fans out per-year upstream).
    if (Date.now() - _autoYearlyLastRun > AUTO_YEARLY_INTERVAL_HOURS * 3600_000) {
      _autoYearlyLastRun = Date.now();
      importHistoryFromI10({ silent: true }).catch(e => console.warn('yearly piggyback error:', e));
    }
  } catch (err) {
    console.error('I10 sync error:', err);
    showToast('Não deu pra sincronizar agora — tente de novo em instantes.');
  } finally {
    state.i10Syncing = false;
    if (btn) { btn.disabled = false; btn.innerHTML = originalHTML; }
  }
}

// ============================================================
//  AUTO-SYNC — fires syncFromI10 when last sync is older than
//  AUTO_SYNC_INTERVAL_HOURS, triggered by login + visibility change
//  + hourly heartbeat. No external scheduler needed — relies on at
//  least one of the two users opening the app each day. They share
//  the same Firestore doc, so whoever fires first updates everyone.
// ============================================================
const AUTO_SYNC_INTERVAL_HOURS = 1;
// Yearly history (dividendsYearly) é mais pesado de sincronizar
// (chama o worker uma vez por ano). Throttle separado: 24h.
const AUTO_YEARLY_INTERVAL_HOURS = 24;
let _autoYearlyLastRun = 0;
let _autoSyncLastCheck = 0;

function maybeAutoSync(reason = 'unknown') {
  // Debounce: don't re-check more than once per 60s no matter how
  // many events fire. Cheap protection against tab-switch spam.
  if (Date.now() - _autoSyncLastCheck < 60_000) return;
  _autoSyncLastCheck = Date.now();

  // Preconditions: must be logged in, must have wallet config, must
  // not already be syncing, must have at least one prior sync (so we
  // don't fire on a fresh install — the user kicks off the first one
  // manually so they can see it succeed).
  if (!state.user) return;
  if (state.i10Syncing) return;
  if (!state.i10Cfg.workerUrl || !state.i10Cfg.walletId) return;
  if (!state.i10.updatedAt) return;

  const hoursAgo = (Date.now() - state.i10.updatedAt.getTime()) / 3600000;
  if (hoursAgo < AUTO_SYNC_INTERVAL_HOURS) return;

  console.log(`[autosync] reason=${reason} lastSync=${hoursAgo.toFixed(1)}h ago — firing background sync`);
  syncFromI10();
}

// Hook 1: when the tab becomes visible again (user came back to the
// app after switching away). Visibility events also fire on focus.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') maybeAutoSync('visibility');
});

// Hook 2: hourly heartbeat for tabs left open all day long.
setInterval(() => maybeAutoSync('heartbeat'), 60 * 60 * 1000);

// Hook 3 (post-login) is wired inside onAuthStateChanged after the
// Firestore listeners have a chance to populate state.i10.updatedAt.

// ============================================================
//  IMPORT YEARLY HISTORY FROM I10
// ============================================================
// Imports/updates documents in dividendsYearly collection.
// Each year doc uses String(year) as ID to ensure idempotency.
// Skips current year (managed by daily sync) and skips years with zero divs AND zero equity.
async function importYearlyData(yearsArray) {
  const currentYear = new Date().getFullYear();
  let imported = 0;
  for (const row of yearsArray) {
    const year = parseInt(row.year, 10);
    if (!Number.isFinite(year)) continue;
    if (year >= currentYear) continue; // current year managed by daily I10 sync
    const equity = Number.isFinite(+row.equity) ? +row.equity : null;
    const divs = Number.isFinite(+row.divs) ? +row.divs : 0;
    const applied = Number.isFinite(+row.applied) ? +row.applied : null;
    const flow = Number.isFinite(+row.flow) ? +row.flow : null;
    // Skip empty years
    if ((!equity || equity === 0) && divs === 0) continue;
    try {
      const docRef = doc(db, 'household', 'main', 'dividendsYearly', String(year));
      // Only include fields that actually have a value. Sending a key
      // with `null` would still WIPE the previous Firestore value (bug
      // hit 2026-04-20 — the I10 yearly endpoint returns null for the
      // fields it can't recover, and the prior setDoc was clobbering
      // hand-seeded equity history). When the source has no equity to
      // give, the previous value is preserved.
      const data = {
        year,
        divs,
        updatedAt: serverTimestamp(),
        updatedBy: (state.user?.displayName || state.user?.email || 'unknown') + ' (i10-import)',
        source: 'investidor10-yearly-import',
      };
      if (equity != null) data.equity = equity;
      if (applied != null) data.applied = applied;
      if (flow != null) data.flow = flow;
      await setDoc(docRef, data, { merge: true });
      imported++;
    } catch (e) {
      console.error('importYearlyData error for', year, e);
    }
  }
  return imported;
}

async function importHistoryFromI10(opts = {}) {
  const silent = !!opts.silent;
  const { workerUrl, walletId } = state.i10Cfg;
  if (!workerUrl || !walletId) {
    if (!silent) {
      showToast('Configure o Worker e Wallet ID primeiro');
      openI10ConfigModal();
    }
    return;
  }
  const btn = silent ? null : $('btnImportHistory');
  const originalHTML = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = 'Importando...'; }
  try {
    const base = workerUrl.replace(/\/+$/, '');
    const res = await fetch(`${base}/i10/yearly/${encodeURIComponent(walletId)}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    if (payload.error) throw new Error(payload.error);
    const years = Array.isArray(payload.years) ? payload.years : [];
    if (years.length === 0) {
      if (!silent) showToast('Nenhum ano retornado pelo I10');
      return;
    }
    const imported = await importYearlyData(years);
    if (!silent) showToast(`Importado: ${imported} ${imported === 1 ? 'ano' : 'anos'} do I10`);
    else console.log(`[autosync] yearly refreshed: ${imported} anos`);
  } catch (err) {
    console.error('importHistoryFromI10 error:', err);
    if (!silent) showToast('Não deu pra importar o histórico agora — tente de novo em instantes.');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = originalHTML; }
  }
}

// ============================================================
//                I10 CONFIG MODAL (Worker URL + Wallet ID)
// ============================================================
function openI10ConfigModal() {
  $('i10CfgWorker').value = state.i10Cfg.workerUrl || '';
  $('i10CfgWallet').value = state.i10Cfg.walletId || '';
  if ($('i10CfgHash')) $('i10CfgHash').value = state.i10Cfg.publicHash || '';
  $('i10CfgModal').classList.add('show');
  setTimeout(() => $('i10CfgWorker').focus(), 50);
}
function closeI10ConfigModal() { $('i10CfgModal').classList.remove('show'); }

async function saveI10Config() {
  const workerUrl = ($('i10CfgWorker').value || '').trim();
  const walletId = ($('i10CfgWallet').value || '').trim();
  const publicHash = (($('i10CfgHash') && $('i10CfgHash').value) || '').trim();
  if (!workerUrl || !/^https?:\/\//.test(workerUrl)) { showToast('Worker URL inválida'); return; }
  if (!walletId || !/^\d+$/.test(walletId)) { showToast('Wallet ID deve ser numérico'); return; }
  const btn = $('i10CfgSave');
  try {
    btn.disabled = true; btn.textContent = 'Salvando...';
    await setDoc(docI10Cfg, {
      workerUrl,
      walletId,
      publicHash,
      updatedAt: serverTimestamp(),
      updatedBy: state.user?.displayName || 'unknown',
    }, { merge: true });
    showToast('Configuração salva');
    closeI10ConfigModal();
    // Auto-sync right after saving, so user sees data immediately
    setTimeout(() => syncFromI10(), 300);
  } catch (err) { console.error(err); showToast(t('toast.error.save')); }
  finally { btn.disabled = false; btn.textContent = 'Salvar'; }
}

// ============================================================
//                I10 EDIT MODAL
// ============================================================
function openI10Modal() {
  const currentYear = new Date().getFullYear();
  $('i10YearInput2').textContent = currentYear;
  $('i10EquityInput').value = state.i10.equity || '';
  $('i10DivsInput').value = state.i10.dividends || '';
  $('i10Modal').classList.add('show');
  setTimeout(() => $('i10EquityInput').focus(), 50);
}
function closeI10Modal() { $('i10Modal').classList.remove('show'); }

async function saveI10() {
  const equity = parseFloat($('i10EquityInput').value);
  const dividends = parseFloat($('i10DivsInput').value);
  if (isNaN(equity) || equity < 0) { showToast('Patrimônio inválido'); return; }
  if (isNaN(dividends) || dividends < 0) { showToast('Dividendos inválidos'); return; }

  const btn = $('i10Save');
  try {
    btn.disabled = true; btn.textContent = 'Salvando...';
    await setDoc(docI10, {
      equity,
      dividends,
      year: new Date().getFullYear(),
      updatedAt: serverTimestamp(),
      updatedBy: state.user?.displayName || 'unknown',
      source: 'manual',
    }, { merge: true });
    showToast('Valores atualizados');
    closeI10Modal();
  } catch (err) { console.error(err); showToast(t('toast.error.save')); }
  finally { btn.disabled = false; btn.textContent = 'Salvar'; }
}

// ============================================================
//                 YEARLY MODAL
// ============================================================
let editingYearlyId = null;
function openYearlyModal(id = null) {
  editingYearlyId = id;
  if (id) {
    const y = state.yearly.find(x => x.id === id); if (!y) return;
    $('yearlyModalTitle').textContent = 'Editar ano';
    $('yearlyYear').value = y.year || '';
    $('yearlyEquity').value = y.equity || '';
    $('yearlyDivs').value = y.divs || '';
    $('yearlyDelete').style.display = '';
  } else {
    $('yearlyModalTitle').textContent = 'Adicionar ano';
    $('yearlyYear').value = '';
    $('yearlyEquity').value = '';
    $('yearlyDivs').value = '';
    $('yearlyDelete').style.display = 'none';
  }
  $('yearlyModal').classList.add('show');
  setTimeout(() => $('yearlyYear').focus(), 50);
}
function closeYearlyModal() { $('yearlyModal').classList.remove('show'); editingYearlyId = null; }

async function saveYearly() {
  const year = parseInt($('yearlyYear').value);
  const equity = parseFloat($('yearlyEquity').value);
  const divs = parseFloat($('yearlyDivs').value);
  if (!year) { showToast('Ano obrigatório'); return; }
  if (isNaN(equity)) { showToast('Patrimônio obrigatório'); return; }
  if (isNaN(divs)) { showToast('Proventos obrigatórios'); return; }
  const data = { year, equity, divs, updatedAt: serverTimestamp() };
  const btn = $('yearlySave');
  try {
    btn.disabled = true; btn.textContent = 'Salvando...';
    if (editingYearlyId) {
      await setDoc(docYearly(editingYearlyId), data, { merge: true });
      showToast('Ano atualizado');
    } else {
      await addDoc(colYearly(), { ...data, createdAt: serverTimestamp() });
      showToast('Ano adicionado');
    }
    closeYearlyModal();
  } catch (err) { console.error(err); showToast(t('toast.error.save')); }
  finally { btn.disabled = false; btn.textContent = 'Salvar'; }
}

async function deleteYearly() {
  if (!editingYearlyId) return;
  const id = editingYearlyId;
  openConfirmModal({
    title: 'Excluir este ano?', sub: 'Esta ação não pode ser desfeita.',
    confirmLabel: 'Sim, excluir', danger: true,
    onConfirm: async () => {
      try {
        await deleteDoc(docYearly(id));
        showToast('Ano excluído');
        closeYearlyModal();
      } catch (err) { console.error(err); showToast(t('toast.error.delete')); }
    },
  });
}

// ============================================================
//                 EVENT LISTENERS
// ============================================================
// Mode switch
document.querySelectorAll('.mode-switch button').forEach(b => {
  b.addEventListener('click', () => switchMode(b.dataset.mode));
});

// Month navigation
$('btnPrevMonth').addEventListener('click', () => {
  const d = state.currentViewMonth;
  state.currentViewMonth = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  renderExpenses();
});
$('btnNextMonth').addEventListener('click', () => {
  const d = state.currentViewMonth;
  state.currentViewMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  renderExpenses();
});

// ============================================================
//                 EXPENSES - BUDGET EDITOR
// ============================================================
function openBudgetModal() {
  const list = $('budgetList');
  if (!list) return;
  const budgets = state.budgets || {};
  list.innerHTML = Object.entries(CATEGORIES).map(([key, cat]) => {
    const current = +budgets[key] || 0;
    const value = current > 0 ? fmtBRLInput(current) : '';
    return `<div class="budget-row" style="--cat-color:${cat.color}">
      <div class="budget-row-icon">${cat.icon}</div>
      <div class="budget-row-name">${cat.label}</div>
      <input type="text" inputmode="decimal" class="budget-row-input" data-cat="${key}" value="${value}" placeholder="—" autocomplete="off" />
    </div>`;
  }).join('');
  // Wire BRL mask to each input (blur to format, Enter to commit)
  list.querySelectorAll('.budget-row-input').forEach(inp => {
    inp.addEventListener('blur', () => {
      const n = parseBRLInput(inp.value);
      inp.value = n > 0 ? fmtBRLInput(n) : '';
    });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); inp.blur(); saveBudgets(); }
    });
  });
  $('budgetModal').classList.add('show');
}
function closeBudgetModal() { $('budgetModal')?.classList.remove('show'); }
async function saveBudgets() {
  const btn = $('budgetSave');
  const originalLabel = t('exp.btn.save');
  const out = {};
  document.querySelectorAll('#budgetList .budget-row-input').forEach(inp => {
    const key = inp.dataset.cat;
    const n = parseBRLInput(inp.value);
    if (n > 0) out[key] = n;
  });
  try {
    btn.disabled = true; btn.textContent = t('exp.btn.saving');
    await setDoc(docBudgets, {
      categories: out,
      updatedAt: serverTimestamp(),
      updatedBy: state.user?.displayName || 'unknown',
    }, { merge: false });
    showToast(t('exp.budget.toast.saved'));
    closeBudgetModal();
  } catch (err) { console.error(err); showToast(t('toast.error.save')); }
  finally { btn.disabled = false; btn.textContent = originalLabel; }
}

// Generic confirm modal — replaces native confirm() across the app
let _confirmState = null;
function openConfirmModal({ title, sub, confirmLabel, cancelLabel, danger, onConfirm } = {}) {
  const modal = $('confirmModal');
  if (!modal) { if (confirm((title || '') + '\n' + (sub || ''))) onConfirm?.(); return; }
  $('confirmTitle').textContent = title || t('exp.delete.title');
  $('confirmSub').textContent = sub || t('exp.delete.sub');
  const okBtn = $('confirmOk');
  const cancelBtn = $('confirmCancel');
  okBtn.textContent = confirmLabel || t('exp.delete.confirm');
  cancelBtn.textContent = cancelLabel || t('exp.btn.cancel');
  okBtn.className = danger === false ? 'btn-primary' : 'btn-danger';
  _confirmState = { onConfirm };
  modal.classList.add('show');
  setTimeout(() => cancelBtn.focus(), 50);
}
function closeConfirmModal() { $('confirmModal')?.classList.remove('show'); _confirmState = null; }
$('confirmCancel')?.addEventListener('click', closeConfirmModal);
$('confirmOk')?.addEventListener('click', async () => {
  const cb = _confirmState?.onConfirm;
  closeConfirmModal();
  if (cb) await cb();
});
$('confirmModal')?.addEventListener('click', e => { if (e.target.id === 'confirmModal') closeConfirmModal(); });

// Net-worth pill → jump to Investments tab
$('expNwPill')?.addEventListener('click', () => switchMode('investments'));

// Table search — live filter, only the current month's rows are touched
$('expSearch')?.addEventListener('input', e => {
  _expSearchQuery = e.target.value || '';
  renderExpenseTable(_lastMonthExp);
});

// CSV export
$('btnExportCsv')?.addEventListener('click', exportCurrentMonthCSV);

// Budget modal
$('btnEditBudgets')?.addEventListener('click', openBudgetModal);
$('budgetCancel')?.addEventListener('click', closeBudgetModal);
$('budgetSave')?.addEventListener('click', saveBudgets);
$('budgetModal')?.addEventListener('click', e => { if (e.target.id === 'budgetModal') closeBudgetModal(); });

// Expense modal
// ============================================================
//  IMPORTADOR DE FATURA DO CARTÃO (PDF) — v1
//  Lê o PDF (Bradesco) NO NAVEGADOR via PDF.js (CDN, lazy), parseia os
//  lançamentos, dá palpite de "de quem" + categoria, e grava em lote nas
//  despesas com anti-duplicata. O PDF nunca sai do navegador.
// ============================================================
let _pdfjsLib = null;
async function loadPdfJs() {
  if (_pdfjsLib) return _pdfjsLib;
  const lib = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs');
  try { lib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs'; } catch (e) {}
  _pdfjsLib = lib;
  return lib;
}
async function extractPdfLines(file) {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const rows = new Map();
    for (const it of tc.items) {
      const s = (it.str || '').trim();
      if (!s) continue;
      const y = Math.round(it.transform[5]);
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x: it.transform[4], s });
    }
    [...rows.keys()].sort((a, b) => b - a).forEach(y => {
      const line = rows.get(y).sort((a, b) => a.x - b.x).map(o => o.s).join(' ').replace(/\s+/g, ' ').trim();
      if (line) lines.push(line);
    });
  }
  return lines;
}
const IMP_CAT_RULES = [
  ['alimentacao', ['restaurante','coffee','cafe','padaria','panific','supermerc','mercado','koch','unidos','cooper','ifood','burger','pizza','lanche','hortifruti','acougue','sinuelo','garcia']],
  ['transporte', ['uber','99app','posto','combust','veloe','pedagio','estacion','parking','rek park','latam','gol ','azul','auto re','isleb']],
  ['saude', ['vacina','farmacia','panvel','drogaria','droga','maxiderma','clinica','odonto','hospital','laborat','exame','psico','esthetic','dunnia','htm*','dra ']],
  ['assinaturas', ['netflix','google youtu','youtube','kindle unltd','spotify','amazon prime','livelo','disney','hbo','prime video','dl*google']],
  ['educacao', ['escola','colegio','faculdade','curso','udemy','alura','milium','livraria','ensino','academia','agrico']],
  ['lazer', ['cinema','ingresso','steam','playstation','xbox','teatro','parque','hotel','booking','airbnb','barbearia','beauty','mazi','salao','estetica','rasato']],
  ['compras', ['amazon','shopee','mercadolivre','mercado livre','magazine','magalu','riachuelo','renner','c&a','shein','aliexpress','marketplace','americanas','centauro','bluvitta','espor','neumarkt','mlb','fazstore','blusa','loja']],
  ['moradia', ['aluguel','condominio','imobil','energia','copel','celesc','sanepar','internet','claro','vivo','tim ','enel','empreend','conta de gas','conta de telefone']],
];
function impCategorize(desc) {
  const d = ' ' + (desc || '').toLowerCase() + ' ';
  for (const [c, ks] of IMP_CAT_RULES) if (ks.some(k => d.includes(k))) return c;
  return 'outros';
}
const IMP_KIDS = ['escola','colegio','agrico','milium','clubkids','baby','kids','crianc','pediatr','brinq','luddi'];
const IMP_HOUSE = ['supermerc','unidos','koch','cooper','mercado garcia',' garcia','posto','combust','veloe','pedagio','auto re','empreend','condom','energia','copel','sanepar','conta de gas','conta de telefone'];
const IMP_FEM = ['maxiderma','esthetic','mazi','beauty','dunnia','htm*','salao','manicure','depil','estetica','mulhe','panvel'];
const IMP_MAL = ['rasato','barbearia'];
function impHolderOwner(holder) {
  const h = (holder || '').toUpperCase();
  if (h.includes('WILLIAM')) return 'william';
  if (h.includes('FLAVIA') || h.includes('VERGARA')) return 'flavia';
  return 'familia';
}
function impPersonGuess(tx) {
  const d = ' ' + (tx.desc || '').toLowerCase() + ' ';
  if (IMP_KIDS.some(k => d.includes(k))) return 'louise';
  if (IMP_HOUSE.some(k => d.includes(k))) return 'familia';
  if (IMP_FEM.some(k => d.includes(k))) return 'flavia';
  if (IMP_MAL.some(k => d.includes(k))) return 'william';
  return impHolderOwner(tx.holder);
}
function parseStatement(lines) {
  const out = [];
  let holder = '';
  const HOLDER = /^([A-ZÀ-Ý][A-ZÀ-Ý '.]+?)\s*-\s*VISA/;
  const ROW = /^(\d{2}\/\d{2})\s+(.+?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})$/;
  const SKIP = /(SALDO ANTERIOR|PAGTO|TOTAL|ENCARGOS|^JUROS|ANUIDADE|^IOF|MULTA|LIMITE)/i;
  for (const L of lines) {
    const h = L.match(HOLDER);
    if (h) { holder = h[1].replace(/\s+/g, ' ').trim(); continue; }
    const m = L.match(ROW);
    if (!m) continue;
    let desc = m[2].replace(/\s+/g, ' ').trim();
    if (!desc || SKIP.test(desc)) continue;
    let inst = null;
    const im = desc.match(/\b(\d{1,2}\/\d{1,2})\b\s*$/) || desc.match(/\b(\d{1,2}\/\d{1,2})\b/);
    if (im) { inst = im[1]; desc = desc.replace(im[0], '').replace(/\s+/g, ' ').trim(); }
    const value = parseFloat(m[3].replace(/\./g, '').replace(',', '.'));
    if (!isFinite(value) || value <= 0) continue;  // ignora estornos/créditos — não são despesa
    out.push({ date: m[1], desc, inst, value, holder, refund: false });
  }
  return out;
}
function impToISO(ddmm) {
  const parts = (ddmm || '').split('/');
  const d = +parts[0], mo = +parts[1];
  if (!d || !mo) return new Date().toISOString().split('T')[0];
  const now = new Date();
  let y = now.getFullYear();
  if (mo > now.getMonth() + 2) y -= 1;  // mês muito à frente → ano passado
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function impFp(date, value, desc) {
  return date + '|' + (Math.round((+value) * 100) / 100).toFixed(2) + '|' + (desc || '').slice(0, 16).toLowerCase().replace(/\s+/g, '');
}
const impMoney = (n) => 'R$ ' + Math.abs(+n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let _importTxns = [];
async function handleImportFile(file) {
  if (!file) return;
  showToast(t('imp.reading'));
  let lines;
  try { lines = await extractPdfLines(file); }
  catch (e) { console.error('[import] pdf read failed', e); showToast(t('imp.fail.read')); return; }
  const txns = parseStatement(lines);
  if (!txns.length) { showToast(t('imp.none')); return; }
  _importTxns = txns;
  renderImportReview();
}
function impUpdateConfirm() {
  const n = document.querySelectorAll('#importList .imp-row input[type="checkbox"]:checked').length;
  const btn = $('importConfirm');
  if (btn) { btn.textContent = t('imp.confirm').replace('{n}', n); btn.disabled = n === 0; }
}
function renderImportReview() {
  const ownerOpts = OWNERS.map(o => `<option value="${o}">${esc(t('exp.owner.' + o))}</option>`).join('');
  const catOpts = Object.keys(CATEGORIES).map(k => `<option value="${k}">${esc(CATEGORIES[k].label)}</option>`).join('');
  const rows = _importTxns.map((tx, i) => {
    const owner = impPersonGuess(tx);
    const cat = impCategorize(tx.desc);
    // Todos os portadores são cartões ADICIONAIS da conta do casal (outras
    // pessoas compram por eles) → todo lançamento é gasto de vocês. Só o
    // estorno (crédito/devolução) vem desmarcado por padrão.
    const checked = !tx.refund ? 'checked' : '';
    const badges = (tx.inst ? `<span class="imp-badge">${esc(tx.inst)}</span> ` : '') + (tx.refund ? `<span class="imp-badge ref">estorno</span> ` : '');
    const card = tx.holder ? `<span class="imp-card">· cartão ${esc(tx.holder.split(' ')[0])}</span>` : '';
    return `<label class="imp-row">
      <input type="checkbox" data-idx="${i}" ${checked}>
      <span class="imp-date">${esc(tx.date)}</span>
      <span class="imp-desc">${esc(tx.desc)} ${badges}${card}</span>
      <select class="imp-owner" data-idx="${i}">${ownerOpts.replace(`value="${owner}"`, `value="${owner}" selected`)}</select>
      <select class="imp-cat" data-idx="${i}">${catOpts.replace(`value="${cat}"`, `value="${cat}" selected`)}</select>
      <span class="imp-val${tx.refund ? ' ref' : ''}">${tx.refund ? '+ ' : ''}${impMoney(tx.value)}</span>
    </label>`;
  }).join('');
  $('importList').innerHTML = rows;
  $('importCount').textContent = _importTxns.length;
  $('importModal').classList.add('show');
  impUpdateConfirm();
}
async function doImport() {
  // Dedup usa o fp guardado quando existe (parcelas têm fp por parcela), senão
  // o derivado de data+valor+descrição.
  const seen = new Set((state.expenses || []).map(e => e.fp || impFp(e.date, e.value, e.description)));
  // Competência base = mês mais recente da fatura → de onde as parcelas seguem.
  let baseYM = null;
  for (const tx of _importTxns) { const ym = impToISO(tx.date).slice(0, 7); if (!baseYM || ym > baseYM) baseYM = ym; }
  const baseY = baseYM ? +baseYM.slice(0, 4) : new Date().getFullYear();
  const baseM = baseYM ? +baseYM.slice(5, 7) : new Date().getMonth() + 1;
  const monthISO = (off) => { const t0 = baseY * 12 + (baseM - 1) + off; return `${Math.floor(t0 / 12)}-${String((t0 % 12) + 1).padStart(2, '0')}-15`; };

  const checks = [...document.querySelectorAll('#importList .imp-row input[type="checkbox"]:checked')];
  const batch = []; let provCount = 0;
  for (const cb of checks) {
    const tx = _importTxns[+cb.dataset.idx];
    if (!tx) continue;
    const row = cb.closest('.imp-row');
    const owner = row.querySelector('.imp-owner').value;
    const category = row.querySelector('.imp-cat').value;
    const nat = category === 'assinaturas' ? 'fixa' : 'variavel';
    const cardNote = tx.holder ? ('cartão: ' + tx.holder.split(' ')[0]) : '';
    const base = { type: 'expense', description: tx.desc, value: tx.value, category, owner, nature: nat, source: 'import:cartao', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: state.user?.displayName || 'import' };
    const im = (tx.inst || '').match(/^(\d{1,2})\/(\d{1,2})$/);
    if (im) {
      // PARCELADO: provisiona da parcela atual (X) até a última (Y), uma por mês à frente.
      const X = +im[1], Y = +im[2];
      const descKey = (tx.desc || '').slice(0, 16).toLowerCase().replace(/\s+/g, '');
      for (let k = X; k <= Y; k++) {
        const off = k - X, prov = off > 0;
        const fp = `parc|${descKey}|${(Math.round(tx.value * 100) / 100).toFixed(2)}|${k}/${Y}`;
        if (seen.has(fp)) continue;
        // transição: a parcela atual pode já ter sido importada no esquema antigo
        // (data+valor+descrição) — nesse caso não reimporta, só registra o fp novo.
        if (!prov && seen.has(impFp(impToISO(tx.date), tx.value, tx.desc))) { seen.add(fp); continue; }
        seen.add(fp);
        if (prov) provCount++;
        batch.push({ ...base, date: monthISO(off), fp, provisioned: prov, installment: { k, total: Y },
          notes: [cardNote, `parcela ${k}/${Y}` + (prov ? ' · provisão' : '')].filter(Boolean).join(' · ') });
      }
    } else {
      const date = impToISO(tx.date), fp = impFp(date, tx.value, tx.desc);
      if (seen.has(fp)) continue;
      seen.add(fp);
      batch.push({ ...base, date, fp, notes: cardNote });
    }
  }
  if (!batch.length) { showToast(t('imp.alldup')); return; }

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ov = $('importOverlay'), prog = $('importOvProg'), C = 138.2;
  $('importConfirm').disabled = true; $('importCancel').disabled = true;
  if (ov && !reduce) {
    ov.classList.remove('done'); ov.hidden = false;
    if ($('importOvText')) $('importOvText').textContent = t('imp.importing');
    if ($('importOvSub')) $('importOvSub').textContent = '';
    if (prog) {
      prog.style.transition = 'none'; prog.style.strokeDashoffset = C;
      void prog.getBoundingClientRect();
      prog.style.transition = 'stroke-dashoffset .7s var(--ease-out)';
      requestAnimationFrame(() => { prog.style.strokeDashoffset = String(C * 0.12); });
    }
  }
  // Dispara TODAS as gravações sem esperar a rede — nunca trava. Cada uma
  // com catch próprio; o Firestore confirma em background e o onSnapshot
  // atualiza a lista de Despesas conforme cada lançamento cai.
  batch.forEach(d => addDoc(colExpenses(), d).catch(err => console.error('[import] doc falhou', err)));
  try {
    if (ov && !reduce) {
      await new Promise(r => setTimeout(r, 760));   // anel enchendo (cosmético)
      ov.classList.add('done');
      if ($('importOvText')) $('importOvText').textContent = t('imp.ready');
      const sub = $('importOvSub');
      if (sub) { sub._cuVal = 0; countUpEl(sub, batch.length, n => '✓ ' + Math.round(n) + ' ' + t('imp.imported') + (provCount > 0 ? ' · +' + provCount + ' provisão' : '')); }
      await new Promise(r => setTimeout(r, 1300));
    } else {
      showToast(t('imp.done').replace('{n}', batch.length));
    }
  } finally {
    $('importModal').classList.remove('show');
    if (ov) { ov.hidden = true; ov.classList.remove('done'); }
    $('importConfirm').disabled = false; $('importCancel').disabled = false;
  }
}
$('btnImportStatement')?.addEventListener('click', () => { const f = $('impFile'); if (f) f.click(); });
$('impFile')?.addEventListener('change', (e) => { const file = e.target.files && e.target.files[0]; e.target.value = ''; handleImportFile(file); });
$('importCancel')?.addEventListener('click', () => $('importModal').classList.remove('show'));
$('importConfirm')?.addEventListener('click', doImport);
// Escape de emergência: clicar no overlay (ou Esc) fecha, caso algo trave.
$('importOverlay')?.addEventListener('click', () => {
  const o = $('importOverlay'); if (o) { o.hidden = true; o.classList.remove('done'); }
  const c = $('importConfirm'), x = $('importCancel'); if (c) c.disabled = false; if (x) x.disabled = false;
});
$('importList')?.addEventListener('change', (e) => { if (e.target.matches('input[type="checkbox"]')) impUpdateConfirm(); });

$('btnAddExpense').addEventListener('click', () => openExpenseModal(null, { type: 'expense' }));

// Atalhos de teclado (desktop): / busca · N nova despesa · 1/2 troca aba · ←/→ mês
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
  if (document.querySelector('.modal-bg.show')) return;     // modal manda no teclado
  if (!state.user) return;
  switch (e.key) {
    case '/': { const s = $('expSearch'); if (s) { e.preventDefault(); s.focus(); } break; }
    case 'n': case 'N': e.preventDefault(); openExpenseModal(null, { type: 'expense' }); break;
    case '1': if (typeof switchMode === 'function') switchMode('investments'); break;
    case '2': if (typeof switchMode === 'function') switchMode('expenses'); break;
    case 'ArrowLeft':  if (state.mode === 'expenses') $('btnPrevMonth')?.click(); break;
    case 'ArrowRight': if (state.mode === 'expenses') $('btnNextMonth')?.click(); break;
  }
});
$('btnAddIncome')?.addEventListener('click', () => openExpenseModal(null, { type: 'income' }));
// Modal type toggle (Saída / Ganho)
document.querySelectorAll('#expenseModal .exp-type-opt').forEach(btn => {
  btn.addEventListener('click', () => setModalType(btn.dataset.type));
});
// Modal owner segmented picker
document.querySelectorAll('#expenseModal .exp-owner-opt').forEach(btn => {
  btn.addEventListener('click', () => setModalOwner(btn.dataset.owner));
});
// Modal fixa/variável picker
document.querySelectorAll('#expenseModal .exp-nat-opt').forEach(btn => {
  btn.addEventListener('click', () => setModalNature(btn.dataset.nature));
});
$('expCancel').addEventListener('click', closeExpenseModal);
$('expSave').addEventListener('click', saveExpense);
$('expDelete').addEventListener('click', deleteExpense);
$('expenseModal').addEventListener('click', e => { if (e.target.id === 'expenseModal') closeExpenseModal(); });

// Live BRL mask on the value input — format on blur + keep cursor-friendly typing
(() => {
  const el = $('expValue');
  if (!el) return;
  el.addEventListener('blur', () => {
    const n = parseBRLInput(el.value);
    el.value = n > 0 ? fmtBRLInput(n) : '';
  });
  // Allow only digits, comma, dot, R, $, space — quietly strip the rest
  el.addEventListener('input', () => {
    const cleaned = el.value.replace(/[^\d.,R$\s]/gi, '');
    if (cleaned !== el.value) el.value = cleaned;
  });
  // Enter commits mask then triggers save
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter') { el.blur(); saveExpense(); }
  });
})();

// I10 modal
$('btnEditI10')?.addEventListener('click', openI10Modal);
$('i10Cancel').addEventListener('click', closeI10Modal);
$('i10Save').addEventListener('click', saveI10);
$('i10Modal').addEventListener('click', e => { if (e.target.id === 'i10Modal') closeI10Modal(); });

// I10 Sync button + Config modal
$('btnSyncI10')?.addEventListener('click', syncFromI10);
$('btnImportHistory')?.addEventListener('click', importHistoryFromI10);
document.getElementById('btnAddContrib')?.addEventListener('click', () => { _editingMonth = null; openContribModal(); });
document.getElementById('contribCancel')?.addEventListener('click', closeContribModal);
document.getElementById('contribSave')?.addEventListener('click', saveContrib);
document.getElementById('contribDelete')?.addEventListener('click', deleteContrib);
// BRL mask on the contribution amount (same UX as the expense value field)
(() => {
  const el = document.getElementById('contribAmount');
  if (!el) return;
  el.addEventListener('blur', () => {
    const n = parseBRLInput(el.value);
    el.value = n > 0 ? fmtBRLInput(n) : '';
  });
  el.addEventListener('keydown', e => { if (e.key === 'Enter') { el.blur(); saveContrib(); } });
})();
document.getElementById('contribModal')?.addEventListener('click', e => { if (e.target.id === 'contribModal') closeContribModal(); });
document.getElementById('contribListClose')?.addEventListener('click', closeContribListModal);
document.getElementById('contribListAdd')?.addEventListener('click', () => { closeContribListModal(); openContribModal(); });
document.getElementById('contribListModal')?.addEventListener('click', e => { if (e.target.id === 'contribListModal') closeContribListModal(); });
$('btnCfgI10')?.addEventListener('click', openI10ConfigModal);
$('i10CfgCancel')?.addEventListener('click', closeI10ConfigModal);
$('i10CfgSave')?.addEventListener('click', saveI10Config);
$('i10CfgModal')?.addEventListener('click', e => { if (e.target.id === 'i10CfgModal') closeI10ConfigModal(); });

// Yearly modal
$('btnAddYear').addEventListener('click', () => openYearlyModal());
$('yearlyCancel').addEventListener('click', closeYearlyModal);
$('yearlySave').addEventListener('click', saveYearly);
$('yearlyDelete').addEventListener('click', deleteYearly);
$('yearlyModal').addEventListener('click', e => { if (e.target.id === 'yearlyModal') closeYearlyModal(); });

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeExpenseModal();
    closeI10Modal();
    closeYearlyModal();
    closeI10ConfigModal();
  }
});

// ============================================================
//                 FIRESTORE SUBSCRIPTIONS
// ============================================================
let unsub = {};
function subscribeAll() {
  unsub.expenses = onSnapshot(colExpenses(), (snap) => {
    state.expenses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (state.mode === 'expenses') renderExpenses();
  });
  unsub.yearly = onSnapshot(colYearly(), (snap) => {
    state.yearly = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    window.__ledgerYearly = state.yearly;
    if (state.mode === 'investments') renderInvestments();
  });
  unsub.config = onSnapshot(docConfig, (snap) => {
    const data = snap.data() || {};
    if (typeof data.dividendsYearlyGoal === 'number') state.dividendsYearlyGoal = data.dividendsYearlyGoal;
    if (typeof data.dividendsYearlyGoalYear === 'number') state.dividendsYearlyGoalYear = data.dividendsYearlyGoalYear;
    // Sync theme from Firestore (cross-device)
    if (data.theme === 'light' || data.theme === 'dark') {
      const current = document.documentElement.getAttribute('data-theme');
      if (current !== data.theme) {
        document.documentElement.setAttribute('data-theme', data.theme);
        try { localStorage.setItem('ledger-theme', data.theme); } catch(e) {}
      }
    }
    // Sync lang from Firestore
    if ((data.lang === 'pt' || data.lang === 'en') && data.lang !== getLang()) {
      try { localStorage.setItem('ledger-lang', data.lang); } catch(e) {}
      applyI18n();
    }
    if (state.mode === 'investments') renderInvestments();
  });
  unsub.fx = onSnapshot(docFx, (snap) => {
    if (snap.exists()) {
      const d = snap.data();
      let upd = null;
      if (d.rateUpdatedAt) {
        upd = typeof d.rateUpdatedAt.toDate === 'function' ? d.rateUpdatedAt.toDate() : d.rateUpdatedAt;
      }
      state.fx = {
        usd: +d.usd || 0,
        rateUSD: +d.rateUSD || 0,
        rateUpdatedAt: upd,
        rateSource: d.rateSource || '',
        note: d.note || '',
      };
      updateLedgerEquity();
      // The USD row + hero are fully rebuilt by renderInvestments →
      // renderI10Assets. (Old renderFX() was dead+broken — it targeted
      // ids that don't exist and threw, blocking this re-render.)
      if (state.mode === 'investments') renderInvestments();
    }
  });
  unsub.i10Louise = onSnapshot(docI10Louise, (snap) => {
    if (snap.exists()) {
      const d = snap.data();
      let updatedAt = null;
      if (d.updatedAt) {
        updatedAt = typeof d.updatedAt.toDate === 'function' ? d.updatedAt.toDate() : d.updatedAt;
      }
      state.i10Louise = {
        equity: +d.equity || 0,
        dividends: +d.dividends || 0,
        applied: +d.applied || 0,
        variation: +d.variation || 0,
        updatedAt,
      };
      renderLouise();
    }
  });
  unsub.i10 = onSnapshot(docI10, (snap) => {
    const data = snap.data() || {};
    state.i10.equity = +data.equity || 0;
    updateLedgerEquity();
    state.i10.dividends = +data.dividends || 0;
    state.i10.updatedAt = data.updatedAt?.toDate?.() || null;
    state.i10.year = data.year || new Date().getFullYear();
    state.i10.assets = Array.isArray(data.assets) ? data.assets : [];
    state.i10.categories = Array.isArray(data.categories) ? data.categories : [];
    state.i10.monthly = Array.isArray(data.monthly) ? data.monthly : [];
    state.i10.applied = +data.applied || 0;
    state.i10.variation = +data.variation || 0;
    state.i10.profitTwr = +data.profitTwr || 0;
    state.i10.source = data.source || null;
    // Restore ticker->category map persisted by syncFromI10
    if (data.tickerCategories && typeof data.tickerCategories === 'object') {
      _i10TickerCategory = data.tickerCategories;
    }
    if (state.mode === 'investments') renderInvestments();
  });
  unsub.contributions = onSnapshot(colContrib(), (snap) => {
    state.contributions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (state.mode === 'investments') renderContributions();
  });
  unsub.i10Cfg = onSnapshot(docI10Cfg, (snap) => {
    const data = snap.data() || {};
    state.i10Cfg.workerUrl = data.workerUrl || '';
    state.i10Cfg.walletId = data.walletId || '';
    state.i10Cfg.publicHash = data.publicHash || '';
    updateI10Link();
  });
  unsub.reserves = onSnapshot(docReserves, async (snap) => {
    if (!snap.exists()) {
      // First-run: seed with the 3 default empty accounts
      state.reserves.accounts = RESERVES_DEFAULTS.map(a => ({ ...a }));
      state.reserves.loaded = true;
      try {
        await setDoc(docReserves, {
          accounts: state.reserves.accounts,
          updatedAt: serverTimestamp(),
          updatedBy: state.user?.displayName || 'unknown',
          seeded: true,
        });
      } catch (err) { console.warn('reserves seed failed:', err); }
    } else {
      const data = snap.data() || {};
      state.reserves.accounts = Array.isArray(data.accounts) ? data.accounts : [];
      state.reserves.loaded = true;
    }
    updateLedgerEquity();
    if (state.mode === 'investments') renderInvestments();
  });
  unsub.pension = onSnapshot(docPension, async (snap) => {
    if (!snap.exists()) {
      // First-run: seed with default(s) — Bradesco
      state.pension.accounts = PENSION_DEFAULTS.map(a => ({ ...a }));
      state.pension.loaded = true;
      try {
        await setDoc(docPension, {
          accounts: state.pension.accounts,
          updatedAt: serverTimestamp(),
          updatedBy: state.user?.displayName || 'unknown',
          seeded: true,
        });
      } catch (err) { console.warn('pension seed failed:', err); }
    } else {
      const data = snap.data() || {};
      state.pension.accounts = Array.isArray(data.accounts) ? data.accounts : [];
      state.pension.loaded = true;
    }
    updateLedgerEquity();
    if (state.mode === 'investments') renderInvestments();
  });
  unsub.userPrefs = onSnapshot(docUserPrefs, (snap) => {
    state.userPrefs = snap.exists() ? (snap.data() || {}) : {};
  });
  unsub.budgets = onSnapshot(docBudgets, (snap) => {
    const data = snap.exists() ? (snap.data() || {}) : {};
    // Accept both shapes: { categories: {...} } or a flat map with numeric values
    if (data.categories && typeof data.categories === 'object') {
      state.budgets = { ...data.categories };
    } else {
      const flat = {};
      Object.entries(data).forEach(([k, v]) => { if (typeof v === 'number' && k in CATEGORIES) flat[k] = v; });
      state.budgets = flat;
    }
    if (state.mode === 'expenses') renderExpenses();
  });
}
function unsubscribeAll() { Object.values(unsub).forEach(fn => fn && fn()); unsub = {}; }

// ============================================================
//                 AUTH
// ============================================================
$('btnLogin').addEventListener('click', async () => {
  console.log('[auth] Login button clicked');
  $('loginError').classList.remove('show');
  $('btnLoginText').textContent = getLang() === 'en' ? 'Signing in...' : 'Entrando...';
  try {
    console.log('[auth] Calling signInWithPopup...');
    await signInWithPopup(auth, provider);
    console.log('[auth] signInWithPopup resolved');
  } catch (err) {
    console.error('[auth] signInWithPopup error:', err);
    const code = err.code || 'unknown';
    // Humane copy per known code; raw code stays in console only.
    const MAP = {
      'auth/popup-blocked': 'O popup foi bloqueado. Libere popups pra este site e tente de novo.',
      'auth/popup-closed-by-user': 'Login cancelado. Tente de novo quando quiser.',
      'auth/cancelled-popup-request': 'Login cancelado. Tente de novo.',
      'auth/network-request-failed': 'Sem conexão. Verifique a internet e tente de novo.',
      'auth/unauthorized-domain': 'Este domínio não está autorizado pro login. Avise o William.',
    };
    $('loginError').textContent = MAP[code] || 'Não deu pra entrar agora — tente de novo em instantes.';
    $('loginError').classList.add('show');
    $('btnLoginText').textContent = t('login.button');
  }
});
$('btnLogout').addEventListener('click', async () => { unsubscribeAll(); await signOut(auth); });

// ============================================================
//  THEME TOGGLE (light/dark)
// ============================================================
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('ledger-theme', theme); } catch(e) {}
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  // Persist to Firestore for cross-device sync
  if (state.user) {
    setDoc(docConfig, { theme: next, updatedAt: serverTimestamp() }, { merge: true }).catch(e => console.warn('theme save failed', e));
  }
}
document.getElementById('btnThemeToggle')?.addEventListener('click', toggleTheme);

// ============================================================
//  i18n (PT/EN)
// ============================================================

document.getElementById('btnLangToggle')?.addEventListener('click', toggleLang);

onAuthStateChanged(auth, async (user) => {
  _mainAuthRegistered = true;
  window.__bootLog && window.__bootLog('auth state: ' + (user ? 'LOGGED IN as ' + user.email : 'logged out'));
  if (user) {
    state.user = user;
    $('loginScreen').classList.add('hide');
    $('app').classList.add('show');
    $('userName').textContent = user.displayName || user.email;
    if (user.photoURL) $('userPhoto').src = user.photoURL;
    try {
      await setDoc(doc(db, 'household', 'main', 'meta', 'connection'), {
        lastSeenBy: user.displayName || user.email,
        lastSeenAt: serverTimestamp(),
        uid: user.uid,
      }, { merge: true });
      subscribeAll();
      // Initial mode honors the user's last choice (config/userPrefs.{uid}),
      // falls back to 'investments' for the known primary email and
      // 'expenses' for everyone else (spouse/secondary user).
      const initialMode = await pickInitialMode(user);
      switchMode(initialMode, { persist: false });
      // Auto-sync on login: give Firestore listeners ~3s to populate
      // state.i10.updatedAt + state.i10Cfg, then check if a sync is due.
      setTimeout(() => maybeAutoSync('login'), 3000);
    } catch (err) {
      console.error('Firestore error:', err);
    }
  } else {
    state.user = null;
    unsubscribeAll();
    $('loginScreen').classList.remove('hide');
    $('app').classList.remove('show');
    $('btnLoginText').textContent = t('login.button');
  }
});

// Apply i18n on initial load (after onAuthStateChanged is registered)
applyI18n();

// ============================================================
//  MICRO-INTERACTIONS — proximity / "alive" polish (desktop only)
//  Inspired by the dock-proximity pattern: respond to cursor distance,
//  not just binary hover. Two effects, both gated on a fine pointer +
//  no reduced-motion preference:
//    1. Magnetic CTAs — key action buttons drift toward the cursor.
//    2. Hero spotlight — the radial glow tracks the pointer.
//  Nothing scales or shifts content that holds numbers (readability).
// ============================================================
function initMicroFX() {
  // Owner preference (jun/2026): keep the UI STATIC. The magnetic CTAs
  // made "+ Ganho" / "+ Nova despesa" drift into each other on hover, and
  // the cursor-tracking hero glow felt restless ("esse mundo que fica se
  // mexendo não é legal"). Disabled — nothing follows the pointer now.
  return;
  // eslint-disable-next-line no-unreachable
  const fine = window.matchMedia('(pointer: fine)').matches;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!fine || reduce) return;

  // ---- 1. Magnetic buttons ----
  const MAG_IDS = ['btnSyncI10', 'btnAddExpense', 'btnAddIncome', 'btnAddContrib', 'btnAddYear', 'btnImportHistory'];
  const magnets = MAG_IDS.map(id => document.getElementById(id)).filter(Boolean);
  magnets.forEach(el => el.classList.add('magnetic'));
  const R = 95;          // activation radius (px)
  const PULL_X = 0.28;   // horizontal pull factor
  const PULL_Y = 0.40;   // vertical pull factor (a touch stronger)

  let pending = false;
  let lastX = 0, lastY = 0;
  function applyMagnets() {
    pending = false;
    for (const el of magnets) {
      if (!el.offsetParent) { el.style.transform = ''; continue; } // hidden
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = lastX - cx, dy = lastY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist < R) {
        el.style.transform = `translate(${(dx * PULL_X).toFixed(1)}px, ${(dy * PULL_Y).toFixed(1)}px)`;
      } else if (el.style.transform) {
        el.style.transform = '';
      }
    }
  }
  window.addEventListener('pointermove', (e) => {
    lastX = e.clientX; lastY = e.clientY;
    if (!pending) { pending = true; requestAnimationFrame(applyMagnets); }
  }, { passive: true });

  // ---- 2. Hero spotlight ----
  document.querySelectorAll('.hero-card, .exp-hero').forEach(hero => {
    hero.addEventListener('pointermove', (e) => {
      const r = hero.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 100;
      const y = ((e.clientY - r.top) / r.height) * 100;
      hero.style.setProperty('--spot-x', x.toFixed(1) + '%');
      hero.style.setProperty('--spot-y', y.toFixed(1) + '%');
    }, { passive: true });
    hero.addEventListener('pointerleave', () => {
      hero.style.removeProperty('--spot-x');
      hero.style.removeProperty('--spot-y');
    }, { passive: true });
  });
}
initMicroFX();

// Re-render bar charts on resize (debounced) so mobile/desktop viewBox swap kicks in on rotate.
let _resizeTimer = null;
let _wasMobile = typeof window !== 'undefined' && window.innerWidth < 600;
window.addEventListener('resize', () => {
  if (_resizeTimer) clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => {
    const isMobileNow = window.innerWidth < 600;
    if (isMobileNow !== _wasMobile) {
      _wasMobile = isMobileNow;
      if (state.user && state.mode === 'investments') {
        if (typeof renderDividendsChart === 'function') renderDividendsChart();
        if (typeof renderPLChart === 'function') renderPLChart();
      }
    }
  }, 200);
});


// ============================================================
//  GOAL SIMULATOR (scoped to avoid $/fmtBRL collision with main module)
// ============================================================
{

const TARGET = 1000000;
const TARGET_YEAR = 2035;
const START_YEAR = 2026;
const DEFAULTS = { aporte: 24000, crescAporte: 10, dy: 8, reinv: 100, crescDiv: 6 };

let saveDebounce = null;
let isLoadingFromFirestore = false;
let userLoaded = false;

const $ = id => document.getElementById(id);
const fmtBRL = v => 'R$ ' + Math.round(v).toLocaleString('pt-BR');
const fmtBRLk = v => v >= 1e6 ? 'R$ ' + (v/1e6).toFixed(2).replace('.',',') + 'M' : 'R$ ' + Math.round(v/1000) + 'k';

function getHistory() {
  // Lê do window.__ledgerState que app.js expoe (yearly history)
  const yearly = window.__ledgerYearly || [];
  return yearly.filter(y => y.equity != null || y.divs != null).sort((a,b) => a.year - b.year)
    .map(y => ({ year: y.year, equity: +y.equity || 0, divs: +y.divs || 0 }));
}

function getCurrentPL() {
  return window.__ledgerEquity || 1795442;
}

function simulate(p) {
  const proj = [];
  let pl = getCurrentPL();
  let metaHitYear = null;
  for (let year = START_YEAR; year <= TARGET_YEAR + 10; year++) {
    const yrIndex = year - START_YEAR;
    const aporteAnual = p.aporte * 12 * Math.pow(1 + p.crescAporte/100, yrIndex);
    const dyAjustado = (p.dy/100) * Math.pow(1 + p.crescDiv/100, yrIndex);
    const divsRecebidos = pl * dyAjustado;
    const reinvestido = divsRecebidos * (p.reinv/100);
    proj.push({ year, pl, divs: divsRecebidos, aporte: aporteAnual });
    if (divsRecebidos >= TARGET && metaHitYear === null) metaHitYear = year;
    pl = pl + aporteAnual + reinvestido;
  }
  return { proj, metaHitYear };
}

function readSliders() {
  // v8 Turno 3: inputs now text-formatted ("R$ 24.000", "10,0%/yr"). Parse via shared helper.
  const parseV = (s) => {
    if (s == null) return 0;
    const c = String(s).replace(/R\$|\s|%|\/yr|\/ano|\./g, '').replace(',', '.');
    const n = parseFloat(c);
    return isFinite(n) ? n : 0;
  };
  return {
    aporte: parseV($('gsAporte').value),
    crescAporte: parseV($('gsCrescAporte').value),
    dy: parseV($('gsDY').value),
    reinv: parseV($('gsReinv').value),
    crescDiv: parseV($('gsCrescDiv').value),
  };
}

function applyParams(p) {
  isLoadingFromFirestore = true;
  // v8 Turno 3: write back as formatted strings to match the text inputs
  const fmtBRLi = (n) => 'R$ ' + Math.round(n).toLocaleString('pt-BR');
  const fmtPctY = (n) => n.toFixed(1).replace('.', ',') + '%/yr';
  const fmtPctP = (n) => n.toFixed(1).replace('.', ',') + '%';
  const fmtPctI = (n) => Math.round(n) + '%';
  $('gsAporte').value = fmtBRLi(p.aporte);
  $('gsCrescAporte').value = fmtPctY(p.crescAporte);
  $('gsDY').value = fmtPctP(p.dy);
  $('gsReinv').value = fmtPctI(p.reinv);
  $('gsCrescDiv').value = fmtPctY(p.crescDiv);
  isLoadingFromFirestore = false;
  render();
}

function saveParams(p) {
  if (saveDebounce) clearTimeout(saveDebounce);
  saveDebounce = setTimeout(async () => {
    try {
      await setDoc(doc(db, 'household', 'main', 'config', 'goalParams'), p, { merge: true });
    } catch (err) { console.warn('saveParams failed:', err); }
  }, 600);
}

function render() {
  const p = readSliders();
  $('gvAporte').textContent = fmtBRL(p.aporte);
  $('gvCrescAporte').textContent = p.crescAporte.toFixed(1).replace('.',',') + '%/ano';
  $('gvDY').textContent = p.dy.toFixed(1).replace('.',',') + '%';
  $('gvReinv').textContent = p.reinv + '%';
  $('gvCrescDiv').textContent = p.crescDiv.toFixed(1).replace('.',',') + '%/ano';

  const { proj, metaHitYear } = simulate(p);

  let cls, txt;
  const tt = (typeof window !== 'undefined' && window.t) ? window.t : (k => k);
  if (metaHitYear === null || metaHitYear > TARGET_YEAR) { cls='red'; txt=tt('goal.status.red'); }
  else if (metaHitYear <= TARGET_YEAR-2) { cls='green'; txt=tt('goal.status.green'); }
  else { cls='yellow'; txt=tt('goal.status.yellow'); }
  $('gStatusPill').className = 'status-pill ' + cls;
  $('gStatusText').textContent = txt;

  $('gStatHit').textContent = metaHitYear || '> '+TARGET_YEAR;
  if (metaHitYear) {
    const d = TARGET_YEAR - metaHitYear;
    $('gStatHitSub').textContent = d > 0 ? d+(d===1?' year early':' years early') : (d < 0 ? Math.abs(d)+(Math.abs(d)===1?' year late':' years late') : 'on schedule');
  } else $('gStatHitSub').textContent = t('goal.notreach');

  const pAt = proj.find(x => x.year === TARGET_YEAR);            // divs durante TARGET_YEAR
  const pAtEnd = proj.find(x => x.year === TARGET_YEAR + 1);      // PL no FIM de TARGET_YEAR
  $('gStatPL').textContent = fmtBRLk(pAtEnd?.pl || 0);
  if ($('gStatProj')) $('gStatProj').textContent = pAt?.divs ? fmtBRLk(pAt.divs) : '-';

  let totApor = 0;
  for (const px of proj) { if (px.year > TARGET_YEAR) break; totApor += px.aporte; }
  $('gStatApor').textContent = fmtBRLk(totApor);

  if (metaHitYear && metaHitYear <= TARGET_YEAR) {
    const yrs = TARGET_YEAR - metaHitYear;
    let phrase;
    if (yrs > 0) {
      phrase = tt('goal.phrase.before').replace('{year}', metaHitYear).replace('{n}', yrs).replace('{label}', yrs===1 ? tt('years.singular') : tt('years.plural'));
    } else {
      phrase = tt('goal.phrase.exact').replace('{year}', TARGET_YEAR);
    }
    $('gNarrative').innerHTML = phrase + tt('goal.phrase.suffix').replace('{amt}', fmtBRL(p.aporte)).replace('{g}', p.crescAporte).replace('{year}', TARGET_YEAR).replace('{pl}', fmtBRLk(pAtEnd?.pl || 0));
  } else if (metaHitYear) {
    const yrs = metaHitYear - TARGET_YEAR;
    $('gNarrative').innerHTML = tt('goal.phrase.after').replace('{year}', metaHitYear).replace('{n}', yrs).replace('{label}', yrs===1 ? tt('years.singular') : tt('years.plural'));
  } else {
    $('gNarrative').innerHTML = tt('goal.phrase.fail');
  }

  drawChart(proj, metaHitYear);
  if (!isLoadingFromFirestore && userLoaded) saveParams(p);
}

function drawChart(proj, metaHitYear) {
  const W=700, H=300, padL=50, padR=30, padT=30, padB=36;
  const innerW=W-padL-padR, innerH=H-padT-padB;
  const history = getHistory();
  const realDivs = history.length ? history : [{year:2020,divs:0},{year:2025,divs:67557}];
  const projDivs = proj.filter(p => p.year <= TARGET_YEAR).map(p => ({year:p.year, divs:p.divs}));
  const minYear=2020, maxYear=TARGET_YEAR;
  const maxDivs = Math.max(TARGET*1.1, ...realDivs.map(d=>d.divs), ...projDivs.map(d=>d.divs));
  const xS = y => padL + ((y-minYear)/(maxYear-minYear))*innerW;
  const yS = v => padT + innerH - (v/maxDivs)*innerH;

  // v8 Turno 4: hatched area + classed paths so @keyframes from Turno 2 engage automatically.
  // Classes the stylesheet hooks: .chart-svg .hatch-layer .history-line .projection-line .current-point .target-point .target-line
  let svg = '<g class="chart-svg">';
  svg += '<defs>';
  svg += '<pattern id="hatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">';
  svg += '<line x1="0" y1="0" x2="0" y2="8" stroke="#AC5FDB" stroke-width="1.2" stroke-opacity=".38"/>';
  svg += '</pattern>';
  svg += '<linearGradient id="histLine" x1="0" y1="0" x2="1" y2="0">';
  svg += '<stop offset="0" stop-color="#8b3fb8"/><stop offset="1" stop-color="#E3A2EE"/>';
  svg += '</linearGradient>';
  svg += '</defs>';

  // Grid Y + labels
  for (const t of [0, 250000, 500000, 750000, 1000000]) {
    const y = yS(t);
    svg += '<line x1="'+padL+'" y1="'+y+'" x2="'+(W-padR)+'" y2="'+y+'" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>';
    const lbl = t===0 ? '0' : (t>=1000000 ? '1M' : (t/1000)+'K');
    svg += '<text x="'+(padL-8)+'" y="'+(y+3)+'" text-anchor="end" fill="#6b6473" font-family="Geist Mono, monospace" font-size="9">'+lbl+'</text>';
  }
  // X labels
  for (const t of [2020,2025,2030,2035]) {
    svg += '<text x="'+xS(t)+'" y="'+(H-padB+18)+'" text-anchor="middle" fill="#6b6473" font-family="Geist Mono, monospace" font-size="10">'+t+'</text>';
  }

  // Target horizontal line (1M) — animated via .target-line
  const yT = yS(TARGET);
  svg += '<line class="target-line" x1="'+padL+'" y1="'+yT+'" x2="'+(W-padR)+'" y2="'+yT+'" stroke="#E3A2EE" stroke-width="1" stroke-dasharray="2 3" opacity=".6"/>';
  svg += '<text x="'+(padL+6)+'" y="'+(yT-6)+'" text-anchor="start" fill="#E3A2EE" font-weight="600" font-family="Geist Mono, monospace" font-size="9" letter-spacing="1" opacity=".7">TARGET 1M</text>';

  // Hatched area under the history line — anchored at y of last real point, floors at bottom
  const baseY = yS(0);
  const histPts = realDivs.map(d => xS(d.year)+','+yS(d.divs)).join(' L');
  if (realDivs.length >= 2) {
    const firstX = xS(realDivs[0].year);
    const lastX = xS(realDivs[realDivs.length-1].year);
    const areaD = 'M'+firstX+','+baseY+' L'+histPts+' L'+lastX+','+baseY+' Z';
    svg += '<path class="hatch-layer" d="'+areaD+'" fill="url(#hatch)" stroke="none"/>';
  }

  // History solid line — traced on load via tracePath() in app.js
  if (realDivs.length >= 2) {
    const lineD = 'M'+histPts;
    svg += '<path class="history-line" d="'+lineD+'" fill="none" stroke="url(#histLine)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';
  }

  // Projection dashed line — shimmer animation via .projection-line
  const lastReal = realDivs[realDivs.length-1];
  const projPath = [lastReal, ...projDivs.filter(d => d.year > lastReal.year)];
  if (projPath.length >= 2) {
    const projD = 'M' + projPath.map(d => xS(d.year)+','+yS(d.divs)).join(' L');
    svg += '<path class="projection-line" d="'+projD+'" fill="none" stroke="#E3A2EE" stroke-width="2" stroke-linecap="round" opacity=".85"/>';
  }

  // History point markers
  for (const d of realDivs.slice(0, -1)) {
    svg += '<circle cx="'+xS(d.year)+'" cy="'+yS(d.divs)+'" r="3" fill="#E3A2EE" stroke="#29262B" stroke-width="2"/>';
  }
  // Current point (last real) — pulses via .current-point
  svg += '<circle class="current-point" cx="'+xS(lastReal.year)+'" cy="'+yS(lastReal.divs)+'" r="3.5" fill="#E3A2EE" stroke="#29262B" stroke-width="2"/>';

  // Meta hit marker (green glow)
  if (metaHitYear && metaHitYear <= TARGET_YEAR) {
    const hit = proj.find(p => p.year === metaHitYear);
    if (hit) {
      const hx=xS(hit.year), hy=yS(hit.divs);
      svg += '<circle cx="'+hx+'" cy="'+hy+'" r="9" fill="#34e17a" opacity="0.2"/>';
      svg += '<circle cx="'+hx+'" cy="'+hy+'" r="5" fill="#34e17a" stroke="#29262B" stroke-width="2"/>';
    }
  }
  // Target point at 2035 — pulses via .target-point + .target-ring radar ripple (Option C)
  const f = proj.find(p => p.year === TARGET_YEAR);
  if (f) {
    const tx = xS(f.year), ty = yS(f.divs);
    svg += '<circle class="target-ring" cx="'+tx+'" cy="'+ty+'"/>';
    svg += '<circle class="target-point" cx="'+tx+'" cy="'+ty+'" r="4" fill="#fff" stroke="#E3A2EE" stroke-width="2"/>';
  }

  svg += '</g>';
  $('gChart').innerHTML = svg;

  // v8 Turno 4: one-shot stroke-dashoffset trace on first successful draw
  if (!window._chartTraced) {
    window._chartTraced = true;
    requestAnimationFrame(() => {
      const h = document.querySelector('#gChart .history-line');
      const p = document.querySelector('#gChart .projection-line');
      if (h && h.getTotalLength) {
        const L = h.getTotalLength();
        h.style.strokeDasharray = L;
        h.style.strokeDashoffset = L;
        h.getBoundingClientRect();
        h.style.transition = 'stroke-dashoffset 1400ms cubic-bezier(.2,.8,.2,1)';
        h.style.strokeDashoffset = 0;
      }
      if (p) {
        p.style.opacity = '0';
        setTimeout(() => {
          p.style.transition = 'opacity .8s ease';
          p.style.opacity = '.85';
        }, 1600);
      }
    });
  }
}

// Wire sliders — v8 Turno 3: text inputs fire on `change` (blur) not `input` to avoid reformatting mid-typing
['gsAporte','gsCrescAporte','gsDY','gsReinv','gsCrescDiv'].forEach(id => {
  const el = $(id);
  el.addEventListener('change', render);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } });
});
$('gBtnReset').addEventListener('click', () => { applyParams(DEFAULTS); });

// Auth + Firestore params load
onAuthStateChanged(auth, (user) => {
  if (!user) return;
  userLoaded = true;
  onSnapshot(doc(db, 'household', 'main', 'config', 'goalParams'), (snap) => {
    if (snap.exists()) {
      const d = snap.data();
      applyParams({
        aporte: d.aporte ?? DEFAULTS.aporte,
        crescAporte: d.crescAporte ?? DEFAULTS.crescAporte,
        dy: d.dy ?? DEFAULTS.dy,
        reinv: d.reinv ?? DEFAULTS.reinv,
        crescDiv: d.crescDiv ?? DEFAULTS.crescDiv,
      });
    } else {
      render();
    }
  });
});

// Re-render only when app.js actually updates yearly/equity data (change-detection, no blind polling)
let _lastChartHash = '';
function _chartHash() {
  try {
    const ye = (state.yearly || []).map(y => `${y.year}:${y.equity}:${y.divs}`).join('|');
    const eq = state.i10 ? `${state.i10.equity}:${state.i10.dividends}` : '';
    return ye + '#' + eq;
  } catch (e) { return ''; }
}
setInterval(() => {
  if (!userLoaded) return;
  const h = _chartHash();
  if (h === _lastChartHash) return; // nothing changed → skip redraw → no flash
  _lastChartHash = h;
  const sim = simulate(readSliders());
  drawChart(sim.proj, sim.metaHitYear);
}, 1500);

// Initial render with defaults
render();

// v8 Turno 6 — range toggle listener for bar charts (syncs both cards + triggers re-render)
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-range-toggle] button[data-range]');
  if (!btn) return;
  const range = btn.dataset.range;
  window.chartRange = range;
  // Sync active state across all range-toggle instances
  document.querySelectorAll('[data-range-toggle] button').forEach(b => {
    b.classList.toggle('active', b.dataset.range === range);
  });
  // Re-render the bar charts
  if (typeof renderDividendsChart === 'function') renderDividendsChart();
  if (typeof renderPLChart === 'function') renderPLChart();
});





}
