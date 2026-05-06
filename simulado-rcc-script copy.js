// ================================================================
// CONFIG — SUBSTITUA PELA URL DO SEU APPS SCRIPT
// ================================================================
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/SEU_SCRIPT_ID_AQUI/exec';

// ================================================================
// ESTADO GLOBAL
// ================================================================
let state = {
  nick: '',
  isAdmin: false,
  simuladoTipo: 'treino',
  perguntas: [],
  respostas: [],
  currentQ: 0,
  timerInterval: null,
  timerLeft: 0,
  gabaritoVisible: false,
  config: {
    simulado_real_ativo: false,
    qtd_ccm_cpm: 6,
    qtd_ccb: 2,
    qtd_pce: 2,
    tempo_ccm_cpm: 120,
    tempo_ccb: 90,
    tempo_pce: 90
  },
  adminTab: 'controle',
  correcoes: [],
  perguntasAdmin: [],
  membrosAdmin: []
};

// ================================================================
// AUTH — Forumeiros nick detection
// ================================================================
const normalizeForumIdentity = (v='') => String(v).normalize('NFKC').replace(/\s+/g,' ').trim();
const foldForumIdentity = (v='') => normalizeForumIdentity(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const isBlockedForumIdentity = (v) => {
  const n = foldForumIdentity(v);
  if(!n) return true;
  const blocked=['anonymous','anonymus','anonimo','anonima','anon','modo anonimo','janela anonima','incognito','modo incognito','convidado','guest','visitante','visitor','login','entrar','iniciar sessao','registrar','register'];
  if(blocked.includes(n)) return true;
  if(/\b(anonymous|anonymus|anonimo|anonima)\b/.test(n)) return true;
  return /^(anonymous|anonymus|anonimo|anonima|anon|guest|convidado|visitante|visitor)(\b|[\s_\-.#0-9])/.test(n);
};
const isLoggedOutForumValue = (v) => {
  if(v===undefined||v===null||v==='') return false;
  const n=foldForumIdentity(String(v).replace(/^["']|["']$/g,''));
  return ['0','false','no','nao','não','off','logged_out','logout'].includes(n);
};
const isNonPositiveForumId = (v) => {
  if(v===undefined||v===null||v==='') return false;
  const id=Number(String(v).replace(/^["']|["']$/g,'').trim());
  return Number.isFinite(id)&&id<=0;
};
const forumSessionLooksLoggedOut = (s={}) => {
  if(!s||typeof s!=='object') return false;
  const sf=s.session_logged_in??s.logged_in??s.isLoggedIn;
  const uid=s.user_id??s.userId??s.id;
  return isLoggedOutForumValue(sf)||isNonPositiveForumId(uid);
};
const htmlForumSessionLooksLoggedOut = (html='') => {
  if(!html||typeof html!=='string') return false;
  const sm=html.match(/_userdata(?:\[['"]session_logged_in['"]\]|\.session_logged_in)\s*=\s*([^;\n]+)/i);
  if(sm&&isLoggedOutForumValue(sm[1])) return true;
  const um=html.match(/_userdata(?:\[['"]user_id['"]\]|\.user_id)\s*=\s*([^;\n]+)/i);
  return um?isNonPositiveForumId(um[1]):false;
};

const getForumUsername = async () => {
  const cleanNick=(v)=>{
    if(!v) return '';
    let n=normalizeForumIdentity(v);
    n=n.replace(/^@/,'').trim();
    n=n.replace(/^(ol[aá]|bem[-\s]?vindo(?:\(a\))?)\s*,?\s*/i,'').trim();
    if(n.includes('\n')) n=n.split('\n')[0].trim();
    return n;
  };
  const push=(list,v)=>{const n=cleanNick(v);if(!isBlockedForumIdentity(n))list.push(n);};
  const fromDom=(list,doc)=>{
    if(!doc) return;
    const sels=['meta[name="xf-username"]','meta[name="current-user"]','[data-current-user]','.p-navgroup-link--user .p-navgroup-linkText','.p-navgroup-link--user .username','#elUserLink','#elUserLink_menu strong','.navTab.account .accountUsername','header [class*="user"] [class*="name"]','header a[href*="u="]','header a[href*="members/"]'];
    for(const s of sels){
      const el=doc.querySelector(s);
      if(!el) continue;
      push(list,el.getAttribute('content'));push(list,el.getAttribute('data-current-user'));push(list,el.getAttribute('data-username'));push(list,el.textContent);
    }
  };
  const fromHtml=(list,html)=>{
    if(!html||typeof html!=='string') return;
    if(htmlForumSessionLooksLoggedOut(html)) return;
    const rxs=[/_userdata\["username"\]\s*=\s*"([^"]+)"/i,/_userdata\['username'\]\s*=\s*'([^']+)'/i,/_userdata\.username\s*=\s*"([^"]+)"/i,/_userdata\.username\s*=\s*'([^']+)'/i,/"username"\s*:\s*"([^"]+)"/i];
    for(const rx of rxs){const m=html.match(rx);if(m&&m[1]){push(list,m[1]);if(list.length>0)return;}}
    try{const d=new DOMParser().parseFromString(html,'text/html');fromDom(list,d);}catch(e){}
  };
  const cands=[];
  const globals=[window?._userdata,window?.XF?.config?.visitor,window?.IPB?.member,window?.currentUser,window?.Forum?.user].filter(Boolean);
  const loggedOut=globals.some(forumSessionLooksLoggedOut);
  if(!loggedOut){
    push(cands,window?.XF?.config?.visitor?.username);push(cands,window?.XF?.config?.visitor?.name);
    push(cands,window?.IPB?.member?.name);push(cands,window?._userdata?.username);
    push(cands,window?.currentUser?.username);push(cands,window?.Forum?.user?.name);
  }
  if(!loggedOut) fromDom(cands,document);
  for(const url of ['/forum','/']){
    try{
      const r=await fetch(url,{credentials:'same-origin',cache:'no-store'});
      if(!r.ok) continue;
      const html=await r.text();
      fromHtml(cands,html);
      if(cands.length>0) break;
    }catch(e){}
  }
  const uniq=[...new Set(cands)];
  return uniq.find(c=>!isBlockedForumIdentity(c))||'';
};

// ================================================================
// LOG AUTH
// ================================================================
function addLog(msg) {
  const el=document.getElementById('auth-log');
  const div=document.createElement('div');
  div.textContent=msg;
  el.appendChild(div);
  el.scrollTop=el.scrollHeight;
}

// ================================================================
// INIT AUTH
// ================================================================
async function initAuth() {
  addLog('Iniciando verificação do fórum...');
  let nick='';
  try {
    nick=await getForumUsername();
  } catch(e) {
    addLog('Erro ao capturar nick: '+e.message);
  }

  if(!nick||isBlockedForumIdentity(nick)) {
    addLog('Nenhuma conta válida detectada.');
    document.getElementById('status-dot').classList.add('err');
    document.getElementById('status-text').textContent='Não autenticado no fórum';
    document.getElementById('auth-denied').classList.remove('hidden');
    return;
  }

  addLog('Nick capturado: '+nick);
  addLog('Verificando no banco de membros...');

  // Verifica no Sheets
  try {
    const res=await apiGet('verificar_membro',{nick});
    if(!res.autorizado) {
      addLog('Nick não autorizado no sistema.');
      document.getElementById('status-dot').classList.add('err');
      document.getElementById('status-text').textContent='Nick não autorizado';
      document.getElementById('auth-denied').classList.remove('hidden');
      return;
    }
    addLog('Membro autorizado. Cargo: '+res.cargo);
    state.nick=nick;
    state.isAdmin=!!res.is_admin;

    document.getElementById('status-dot').classList.add('ok');
    document.getElementById('status-text').textContent='Identidade verificada — '+nick;
    addLog('Acesso liberado!');

    const btn=document.getElementById('btn-entrar');
    btn.classList.remove('hidden');
    btn.textContent='▶ Entrar como '+nick;
  } catch(e) {
    // Fallback: se o Sheets não estiver configurado ainda, permite entrada pelo nick do fórum
    addLog('Apps Script não configurado. Modo de demonstração ativado.');
    state.nick=nick;
    state.isAdmin=true; // demo admin
    document.getElementById('status-dot').classList.add('ok');
    document.getElementById('status-text').textContent='Identidade verificada — '+nick;
    const btn=document.getElementById('btn-entrar');
    btn.classList.remove('hidden');
    btn.textContent='▶ Entrar como '+nick;
  }
}

function entrarNoSistema() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('main').style.paddingTop='80px';

  // Show avatar
  const avatar=document.getElementById('avatar-img');
  avatar.src=`https://www.habbo.com.br/habbo-imaging/avatarimage?&user=${encodeURIComponent(state.nick)}&action=std&direction=4&head_direction=4&img_format=png&gesture=std&headonly=1&size=l`;
  document.getElementById('nick-name').textContent=state.nick;
  document.getElementById('avatar-area').classList.remove('hidden');
  document.getElementById('header-nav').classList.remove('hidden');
  if(state.isAdmin) document.getElementById('admin-nav-btn').classList.remove('hidden');

  showScreen('home');
  loadConfig();
  loadUserStats();
}

// ================================================================
// API CALLS
// ================================================================
async function apiGet(action, params={}) {
  const url=new URL(APPS_SCRIPT_URL);
  url.searchParams.set('action',action);
  for(const [k,v] of Object.entries(params)) url.searchParams.set(k,v);
  const res=await fetch(url.toString(),{method:'GET'});
  if(!res.ok) throw new Error('HTTP '+res.status);
  return res.json();
}

async function apiPost(action, data={}) {
  const res=await fetch(APPS_SCRIPT_URL,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action,...data})
  });
  if(!res.ok) throw new Error('HTTP '+res.status);
  return res.json();
}

// ================================================================
// SCREENS
// ================================================================
const screens=['auth-screen','home-screen','simulado-screen','result-screen','admin-screen'];
function showScreen(name) {
  screens.forEach(s=>{
    const el=document.getElementById(s);
    if(el) el.classList.add('hidden');
  });
  const target=document.getElementById(name+'-screen');
  if(target) target.classList.remove('hidden');

  document.querySelectorAll('.nav-btn:not(.admin-btn)').forEach(b=>b.classList.remove('active'));
  if(name==='home') document.querySelector('.nav-btn:first-child')?.classList.add('active');
}

// ================================================================
// CONFIG
// ================================================================
async function loadConfig() {
  try {
    const data=await apiGet('config');
    Object.assign(state.config,data);
  } catch(e) {
    // usa defaults
  }
  renderConfig();
  updateRealMode();
}

function renderConfig() {
  const c=state.config;
  document.getElementById('config-display').innerHTML=`
    <div class="stat-box"><div class="stat-num">${c.qtd_ccm_cpm}</div><div class="stat-label">CCM / CPM</div></div>
    <div class="stat-box"><div class="stat-num">${c.qtd_ccb}</div><div class="stat-label">CCB</div></div>
    <div class="stat-box"><div class="stat-num">${c.qtd_pce}</div><div class="stat-label">PCE</div></div>
    <div class="stat-box"><div class="stat-num">${c.qtd_ccm_cpm+c.qtd_ccb+c.qtd_pce}</div><div class="stat-label">Total</div></div>
  `;
  const tog=document.getElementById('toggle-real');
  if(tog) tog.className='toggle-switch'+(c.simulado_real_ativo?' on':'');
}

function updateRealMode() {
  const card=document.getElementById('real-mode-card');
  const badge=document.getElementById('real-badge');
  const desc=document.getElementById('real-desc');
  const navBtn=document.getElementById('real-nav-btn');
  if(!card) return;
  if(state.config.simulado_real_ativo) {
    card.classList.remove('locked');
    card.classList.add('available');
    badge.className='mode-badge badge-open';
    badge.innerHTML='<span class="dot-badge dot-open"></span>Disponível';
    navBtn.style.color='';
  } else {
    card.classList.add('locked');
    card.classList.remove('available');
    badge.className='mode-badge badge-locked';
    badge.innerHTML='<span class="dot-badge dot-locked"></span>Bloqueado';
  }
}

async function loadUserStats() {
  try {
    const data=await apiGet('stats_usuario',{nick:state.nick});
    document.getElementById('stat-treinos').textContent=data.treinos||'0';
    document.getElementById('stat-acertos').textContent=(data.taxa_acerto||0)+'%';
    document.getElementById('stat-reais').textContent=data.reais||'0';
    document.getElementById('stat-nota').textContent=data.ultima_nota||'—';
  } catch(e) {
    document.getElementById('stat-treinos').textContent='—';
  }
}

// ================================================================
// SIMULADO TREINO / REAL
// ================================================================
function tentarReal() {
  if(!state.config.simulado_real_ativo) {
    showToast('O simulado real está bloqueado no momento.','error');
    return;
  }
  startSimulado('real');
}

async function startSimulado(tipo) {
  state.simuladoTipo=tipo;
  state.respostas=[];
  state.currentQ=0;

  showScreen('simulado');
  document.getElementById('sim-title').textContent=tipo==='treino'?'Simulado Treino':'Simulado Real';
  const badge=document.getElementById('sim-badge');
  badge.textContent=tipo==='treino'?'Treino':'Real';
  badge.className='sim-badge '+(tipo==='treino'?'treino':'real');
  document.getElementById('question-area').innerHTML='<div class="flex-center" style="min-height:300px;"><div class="loading-spinner"></div></div>';

  try {
    const data=await apiGet(tipo==='treino'?'perguntas_treino':'perguntas_real',{nick:state.nick});
    state.perguntas=data.perguntas||[];
  } catch(e) {
    // Modo demo: perguntas de exemplo
    state.perguntas=getDemoPerguntas(tipo);
  }

  if(!state.perguntas.length) {
    document.getElementById('question-area').innerHTML='<div style="text-align:center;padding:3rem;color:var(--text-dim);">Nenhuma pergunta disponível no momento.</div>';
    return;
  }

  document.getElementById('q-total').textContent=state.perguntas.length;
  renderQuestion();
}

function getDemoPerguntas(tipo) {
  const base=[
    {id:'d1',documento:'CCM',pergunta:'Descreva os princípios fundamentais do Código de Conduta Militar e como eles se aplicam ao comportamento do policial em serviço.',gabarito:'O CCM estabelece princípios como hierarquia, disciplina, lealdade e ética profissional. O policial deve manter conduta exemplar tanto em serviço quanto fora dele, respeitando a cadeia de comando e os regulamentos internos.',tempo:120},
    {id:'d2',documento:'CPM',pergunta:'Explique o que constitui uma infração penal militar de acordo com o CPM e quais são as consequências para o infrator.',gabarito:'Infração penal militar é toda ação ou omissão prevista no CPM que lesa bens jurídicos militares. As consequências incluem processos administrativos, afastamento do serviço e penalidades que variam de advertência à expulsão.',tempo:120},
    {id:'d3',documento:'CCM',pergunta:'O que significa a hierarquia militar e por que ela é essencial para o funcionamento de uma organização policial?',gabarito:'Hierarquia é a ordenação dos postos e graduações dentro da estrutura militar. É essencial pois garante a cadeia de comando, a disciplina, a eficiência operacional e a clareza nas responsabilidades de cada membro.',tempo:120},
    {id:'d4',documento:'CPM',pergunta:'Quais são os principais deveres de um militar em relação à sua conduta ética e moral conforme previsto no CPM?',gabarito:'O militar deve pautar sua conduta pela honestidade, probidade e respeito às normas legais e regulamentares. Deve evitar condutas que possam desabonar a imagem da corporação, tanto em serviço quanto na vida privada.',tempo:120},
    {id:'d5',documento:'CCM',pergunta:'Descreva o que é lealdade no contexto militar e cite exemplos de atitudes que demonstram ou que violam esse princípio.',gabarito:'Lealdade é o compromisso com os valores da corporação, com os superiores e com os companheiros. Demonstra-se pela sinceridade, cumprimento de ordens legais e defesa dos interesses da instituição. Viola-se pela traição, desvio de conduta e omissão de informações.',tempo:120},
    {id:'d6',documento:'CCM',pergunta:'Como o código disciplinar prevê o tratamento de conflitos entre militares de diferentes patentes?',gabarito:'O código prevê que conflitos devem ser resolvidos respeitando a hierarquia, com o subordinado podendo recorrer aos canais formais de comunicação sem desrespeitar a cadeia de comando. Agressões físicas ou verbais são passíveis de punição disciplinar.',tempo:120},
    {id:'d7',documento:'CCB',pergunta:'Quais são as atribuições do Comandante do Batalhão e como ele deve conduzir a gestão da unidade?',gabarito:'O Comandante é responsável pelo planejamento estratégico, gestão de pessoal, disciplina interna e representação institucional. Deve conduzir reuniões periódicas, avaliar o desempenho dos membros e garantir o cumprimento das normas do CCB.',tempo:90},
    {id:'d8',documento:'CCB',pergunta:'Explique o sistema de turnos previsto no Código de Comando do Batalhão e a importância da cobertura contínua.',gabarito:'O CCB estabelece turnos rotativos para garantir a presença constante da corporação. A cobertura contínua é fundamental para a ordem e segurança, evitando lacunas que possam ser exploradas por infratores.',tempo:90},
    {id:'d9',documento:'PCE',pergunta:'O que é o Plano de Controle Emergencial e em quais situações ele deve ser acionado?',gabarito:'O PCE é um protocolo de resposta a situações de crise que prevê procedimentos específicos para emergências. Deve ser acionado em situações de conflito interno grave, ameaças externas ou eventos que comprometam a segurança da corporação.',tempo:90},
    {id:'d10',documento:'PCE',pergunta:'Descreva as etapas de execução do PCE e quem são os responsáveis por cada fase.',gabarito:'O PCE possui fases de alertar, conter, neutralizar e normalizar. Cada fase tem um responsável designado na cadeia de comando, desde o oficial de plantão até o Comandante, com comunicação imediata aos superiores hierárquicos.',tempo:90},
  ];
  return tipo==='real' ? base.slice(0,5).map(q=>({...q,gabarito:undefined})) : base;
}

function renderQuestion() {
  const q=state.perguntas[state.currentQ];
  if(!q) { finalizarSimulado(); return; }

  const progresso=((state.currentQ+1)/state.perguntas.length*100).toFixed(0);
  document.getElementById('progress-fill').style.width=progresso+'%';
  document.getElementById('q-current').textContent=state.currentQ+1;

  clearInterval(state.timerInterval);
  state.timerLeft=q.tempo||120;
  state.gabaritoVisible=false;

  const docClass={'CCM':'doc-ccm','CPM':'doc-cpm','PCE':'doc-pce','CCB':'doc-ccb'}[q.documento]||'doc-ccm';
  const treino=state.simuladoTipo==='treino';

  document.getElementById('question-area').innerHTML=`
    <div class="question-card" id="q-card">
      <div class="q-meta">
        <div class="q-num">${String(state.currentQ+1).padStart(2,'0')}</div>
        <div class="q-doc-badge ${docClass}">${q.documento}</div>
        <div class="q-timer" id="q-timer">--:--</div>
      </div>
      <div class="q-text">${q.pergunta}</div>
      <textarea class="q-textarea" id="q-resposta" placeholder="Digite sua resposta aqui..." maxlength="2000"></textarea>
      <div class="q-actions">
        <div class="char-count"><span id="char-n">0</span>/2000</div>
        ${treino?`<button class="btn-primary" style="max-width:180px;margin-top:0;" id="btn-ver-gabarito" onclick="verGabarito()">Ver Gabarito</button>`:''}
        <button class="btn-primary" style="max-width:180px;margin-top:0;${treino?'background:var(--g700);border-color:var(--border);':''}" id="btn-proxima" onclick="proximaPergunta()">${treino?'Próxima ›':'Confirmar Resposta'}</button>
      </div>
      <div id="gabarito-area"></div>
    </div>
  `;

  const textarea=document.getElementById('q-resposta');
  textarea.addEventListener('input',()=>{
    document.getElementById('char-n').textContent=textarea.value.length;
  });

  startTimer(q.tempo||120, treino, q);
}

function startTimer(segundos, isTreino, q) {
  state.timerLeft=segundos;
  updateTimerDisplay();
  state.timerInterval=setInterval(()=>{
    state.timerLeft--;
    updateTimerDisplay();
    if(state.timerLeft<=0) {
      clearInterval(state.timerInterval);
      if(isTreino) { verGabarito(); }
      else { proximaPergunta(); }
    }
  },1000);
}

function updateTimerDisplay() {
  const el=document.getElementById('q-timer');
  if(!el) return;
  const m=Math.floor(state.timerLeft/60);
  const s=state.timerLeft%60;
  el.textContent=String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
  el.className='q-timer';
  if(state.timerLeft<=30) el.classList.add('warning');
  if(state.timerLeft<=10) el.classList.add('danger');
}

function verGabarito() {
  if(state.gabaritoVisible) return;
  state.gabaritoVisible=true;
  clearInterval(state.timerInterval);
  const q=state.perguntas[state.currentQ];
  const el=document.getElementById('gabarito-area');
  if(!el) return;
  el.innerHTML=`
    <div class="gabarito-card">
      <div class="gabarito-title">Gabarito / Resposta Esperada</div>
      <div class="gabarito-text">${q.gabarito||'Gabarito não disponível.'}</div>
      <div class="autoaval-row" id="aval-row">
        <button class="aval-btn aval-acertei" onclick="selecionar_aval('acertei', this)">✓ Acertei</button>
        <button class="aval-btn aval-parcial" onclick="selecionar_aval('parcial', this)">~ Parcial</button>
        <button class="aval-btn aval-errei" onclick="selecionar_aval('errei', this)">✗ Errei</button>
      </div>
    </div>
  `;
  const btnVer=document.getElementById('btn-ver-gabarito');
  if(btnVer) { btnVer.disabled=true; btnVer.style.opacity='.4'; }
}

function selecionar_aval(aval, btn) {
  document.querySelectorAll('.aval-btn').forEach(b=>b.classList.remove('selected'));
  btn.classList.add('selected');
  // Guarda na resposta atual
  if(state.respostas[state.currentQ]) {
    state.respostas[state.currentQ].autoavaliacao=aval;
  }
}

function proximaPergunta() {
  clearInterval(state.timerInterval);
  const q=state.perguntas[state.currentQ];
  const resp=document.getElementById('q-resposta')?.value||'';
  const aval=document.querySelector('.aval-btn.selected')?.getAttribute('onclick')?.match(/selecionar_aval\('(\w+)'/)?.[1]||'';

  state.respostas.push({
    pergunta_id: q.id,
    pergunta: q.pergunta,
    documento: q.documento,
    resposta: resp,
    autoavaliacao: aval,
    gabarito: q.gabarito||''
  });

  state.currentQ++;
  if(state.currentQ>=state.perguntas.length) {
    finalizarSimulado();
  } else {
    renderQuestion();
  }
}

async function finalizarSimulado() {
  clearInterval(state.timerInterval);
  // Salvar no Sheets
  try {
    await apiPost(state.simuladoTipo==='treino'?'salvar_treino':'salvar_real',{
      nick: state.nick,
      respostas: state.respostas,
      tipo: state.simuladoTipo
    });
  } catch(e) {}

  showScreen('result');
  renderResult();
}

function renderResult() {
  const tipo=state.simuladoTipo;
  document.getElementById('result-title').textContent=tipo==='treino'?'Treino Finalizado':'Simulado Real Concluído';
  document.getElementById('result-sub').textContent=tipo==='treino'?'Respostas salvas. Continue praticando!':'Suas respostas foram enviadas para correção.';

  if(tipo==='treino') {
    const ac=state.respostas.filter(r=>r.autoavaliacao==='acertei').length;
    const par=state.respostas.filter(r=>r.autoavaliacao==='parcial').length;
    const err=state.respostas.filter(r=>r.autoavaliacao==='errei').length;
    document.getElementById('result-stats').innerHTML=`
      <div class="result-stat"><div class="result-stat-n acertei">${ac}</div><div class="result-stat-l">Acertei</div></div>
      <div class="result-stat"><div class="result-stat-n parcial">${par}</div><div class="result-stat-l">Parcial</div></div>
      <div class="result-stat"><div class="result-stat-n errei">${err}</div><div class="result-stat-l">Errei</div></div>
    `;
  } else {
    document.getElementById('result-stats').innerHTML=`
      <div class="result-stat" style="grid-column:1/-1"><div class="result-stat-n" style="color:var(--gold)">${state.respostas.length}</div><div class="result-stat-l">Respostas enviadas</div></div>
    `;
  }
}

function confirmBack() {
  if(confirm('Tem certeza que quer sair? O progresso será perdido.')) {
    clearInterval(state.timerInterval);
    showScreen('home');
  }
}

// ================================================================
// ADMIN
// ================================================================
function switchAdminTab(tab) {
  state.adminTab=tab;
  document.querySelectorAll('.admin-tab').forEach((t,i)=>{
    const tabs=['controle','correcoes','perguntas','membros'];
    t.className='admin-tab'+(tabs[i]===tab?' active':'');
  });
  ['controle','correcoes','perguntas','membros'].forEach(t=>{
    document.getElementById('tab-'+t)?.classList.toggle('hidden',t!==tab);
  });
  if(tab==='correcoes') loadCorrecoes();
  if(tab==='perguntas') loadPerguntasAdmin();
  if(tab==='membros') loadMembrosAdmin();
}

async function toggleSimuladoReal() {
  const novo=!state.config.simulado_real_ativo;
  try {
    await apiPost('toggle_real',{ativo:novo});
    state.config.simulado_real_ativo=novo;
    renderConfig();
    updateRealMode();
    showToast('Simulado real '+(novo?'liberado':'bloqueado')+'!','success');
  } catch(e) {
    // demo
    state.config.simulado_real_ativo=novo;
    renderConfig();
    updateRealMode();
    showToast('(Demo) Simulado real '+(novo?'liberado':'bloqueado'),'success');
  }
}

function openConfigModal() {
  const c=state.config;
  showModal(`
    <h3>Configurar Perguntas</h3>
    <div class="q-form-grid">
      <div class="form-group"><label>Qtd CCM/CPM</label><input type="number" class="modal-input" id="cfg-ccm-cpm" value="${c.qtd_ccm_cpm}" min="1" max="20"></div>
      <div class="form-group"><label>Qtd CCB</label><input type="number" class="modal-input" id="cfg-ccb" value="${c.qtd_ccb}" min="1" max="20"></div>
      <div class="form-group"><label>Qtd PCE</label><input type="number" class="modal-input" id="cfg-pce" value="${c.qtd_pce}" min="1" max="20"></div>
      <div class="form-group"><label>Tempo CCM/CPM (s)</label><input type="number" class="modal-input" id="cfg-tempo-ccm" value="${c.tempo_ccm_cpm}" min="30"></div>
      <div class="form-group"><label>Tempo CCB (s)</label><input type="number" class="modal-input" id="cfg-tempo-ccb" value="${c.tempo_ccb}" min="30"></div>
      <div class="form-group"><label>Tempo PCE (s)</label><input type="number" class="modal-input" id="cfg-tempo-pce" value="${c.tempo_pce}" min="30"></div>
    </div>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeModal()">Cancelar</button>
      <button class="btn-save gold" onclick="salvarConfig()">Salvar Configuração</button>
    </div>
  `);
}

async function salvarConfig() {
  const cfg={
    qtd_ccm_cpm:+document.getElementById('cfg-ccm-cpm').value,
    qtd_ccb:+document.getElementById('cfg-ccb').value,
    qtd_pce:+document.getElementById('cfg-pce').value,
    tempo_ccm_cpm:+document.getElementById('cfg-tempo-ccm').value,
    tempo_ccb:+document.getElementById('cfg-tempo-ccb').value,
    tempo_pce:+document.getElementById('cfg-tempo-pce').value,
  };
  try {
    await apiPost('salvar_config',cfg);
  } catch(e) {}
  Object.assign(state.config,cfg);
  renderConfig();
  closeModal();
  showToast('Configuração salva!','success');
}

async function loadCorrecoes() {
  document.getElementById('correcoes-body').innerHTML='<tr><td colspan="5" style="text-align:center;color:var(--text-dim);padding:2rem;"><div class="loading-spinner" style="display:inline-block;"></div></td></tr>';
  try {
    const data=await apiGet('respostas_real');
    state.correcoes=data.respostas||[];
  } catch(e) {
    state.correcoes=[];
  }
  const tbody=document.getElementById('correcoes-body');
  if(!state.correcoes.length){
    tbody.innerHTML='<tr><td colspan="5" style="text-align:center;color:var(--text-dim);padding:2rem;">Nenhuma resposta encontrada</td></tr>';
    return;
  }
  tbody.innerHTML=state.correcoes.map((r,i)=>`
    <tr>
      <td style="font-family:'Share Tech Mono',monospace;font-size:12px;">${r.nick}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-dim);font-size:12px;">${r.pergunta||''}</td>
      <td><div class="resp-text" title="${r.resposta||''}">${r.resposta||'—'}</div></td>
      <td>${r.corrigido?`<span class="nota-badge nota-corrigido">${r.nota}</span>`:`<span class="nota-badge nota-pendente">Pendente</span>`}</td>
      <td><button class="btn-corrigir" onclick="abrirCorrecao(${i})">Corrigir</button></td>
    </tr>
  `).join('');
}

function abrirCorrecao(idx) {
  const r=state.correcoes[idx];
  showModal(`
    <h3>Corrigir Resposta</h3>
    <div class="modal-field"><div class="modal-label">Membro</div><div class="modal-value" style="font-family:'Share Tech Mono',monospace;">${r.nick}</div></div>
    <div class="modal-field"><div class="modal-label">Pergunta</div><div class="modal-value">${r.pergunta||''}</div></div>
    <div class="modal-field"><div class="modal-label">Resposta do Candidato</div><div class="modal-value">${r.resposta||'Sem resposta'}</div></div>
    <div class="modal-field"><div class="modal-label">Nota (0–10)</div><input type="number" class="modal-input" id="nota-input" value="${r.nota||''}" min="0" max="10" step="0.5" placeholder="Ex: 7.5"></div>
    <div class="modal-field"><div class="modal-label">Gabarito / Feedback</div><textarea class="modal-input" id="gabarito-input" placeholder="Escreva o gabarito ou feedback para o candidato...">${r.gabarito||''}</textarea></div>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeModal()">Cancelar</button>
      <button class="btn-save gold" onclick="salvarCorrecao('${r.id||idx}')">Salvar Correção</button>
    </div>
  `);
}

async function salvarCorrecao(id) {
  const nota=document.getElementById('nota-input').value;
  const gabarito=document.getElementById('gabarito-input').value;
  if(!nota) { showToast('Insira uma nota.','error'); return; }
  try {
    await apiPost('corrigir',{id, nota, gabarito, nick:state.nick});
    showToast('Correção salva!','success');
    closeModal();
    loadCorrecoes();
  } catch(e) {
    showToast('Erro ao salvar. Tente novamente.','error');
  }
}

async function loadPerguntasAdmin() {
  const tbody=document.getElementById('perguntas-body');
  tbody.innerHTML='<tr><td colspan="5" style="text-align:center;padding:2rem;"><div class="loading-spinner" style="display:inline-block;"></div></td></tr>';
  try {
    const data=await apiGet('todas_perguntas');
    state.perguntasAdmin=data.perguntas||[];
  } catch(e) {
    state.perguntasAdmin=getDemoPerguntas('treino').map((q,i)=>({...q,tipo:'treino',tempo_s:q.tempo}));
  }
  filterPerguntas();
}

function filterPerguntas() {
  const tipo=document.getElementById('filter-tipo-q')?.value||'';
  const lista=tipo?state.perguntasAdmin.filter(q=>q.tipo===tipo):state.perguntasAdmin;
  const tbody=document.getElementById('perguntas-body');
  const docClass=(d)=>({'CCM':'doc-ccm','CPM':'doc-cpm','PCE':'doc-pce','CCB':'doc-ccb'}[d]||'doc-ccm');
  if(!lista.length){tbody.innerHTML='<tr><td colspan="5" style="text-align:center;color:var(--text-dim);padding:2rem;">Nenhuma pergunta</td></tr>';return;}
  tbody.innerHTML=lista.map((q,i)=>`
    <tr>
      <td><span class="q-doc-badge ${docClass(q.documento)}" style="font-size:10px;padding:2px 8px;">${q.documento}</span></td>
      <td><span class="nota-badge ${q.tipo==='real'?'nota-pendente':'nota-corrigido'}" style="font-size:10px;">${q.tipo||'treino'}</span></td>
      <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-dim);font-size:12px;" title="${q.pergunta}">${q.pergunta}</td>
      <td style="font-family:'Share Tech Mono',monospace;font-size:12px;">${q.tempo||q.tempo_s||'—'}s</td>
      <td><button class="btn-corrigir" onclick="editarPergunta(${i})">Editar</button></td>
    </tr>
  `).join('');
}

function openAddPerguntaModal(q={}, idx=null) {
  showModal(`
    <h3>${idx!==null?'Editar':'Nova'} Pergunta</h3>
    <div class="q-form-grid">
      <div class="form-group"><label>Documento</label>
        <select class="modal-input" id="p-doc">
          ${['CCM','CPM','CCB','PCE'].map(d=>`<option ${(q.documento||'CCM')===d?'selected':''}>${d}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Tipo</label>
        <select class="modal-input" id="p-tipo">
          <option value="treino" ${(q.tipo||'treino')==='treino'?'selected':''}>Treino</option>
          <option value="real" ${q.tipo==='real'?'selected':''}>Real</option>
        </select>
      </div>
    </div>
    <div class="modal-field"><div class="modal-label">Pergunta</div><textarea class="modal-input" id="p-pergunta" style="min-height:80px;">${q.pergunta||''}</textarea></div>
    <div class="modal-field"><div class="modal-label">Gabarito (apenas para treino)</div><textarea class="modal-input" id="p-gabarito" style="min-height:80px;">${q.gabarito||''}</textarea></div>
    <div class="modal-field"><div class="modal-label">Tempo (segundos)</div><input type="number" class="modal-input" id="p-tempo" value="${q.tempo||q.tempo_s||120}" min="30"></div>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeModal()">Cancelar</button>
      <button class="btn-save gold" onclick="salvarPergunta(${idx})">Salvar Pergunta</button>
    </div>
  `);
}

function editarPergunta(idx) {
  openAddPerguntaModal(state.perguntasAdmin[idx],idx);
}

async function salvarPergunta(idx) {
  const dados={
    documento:document.getElementById('p-doc').value,
    tipo:document.getElementById('p-tipo').value,
    pergunta:document.getElementById('p-pergunta').value,
    gabarito:document.getElementById('p-gabarito').value,
    tempo:+document.getElementById('p-tempo').value,
    id:idx!==null?state.perguntasAdmin[idx]?.id:null
  };
  if(!dados.pergunta.trim()){showToast('Escreva a pergunta.','error');return;}
  try {
    await apiPost('salvar_pergunta',dados);
    showToast('Pergunta salva!','success');
    closeModal();
    loadPerguntasAdmin();
  } catch(e) {
    showToast('Erro ao salvar.','error');
  }
}

async function loadMembrosAdmin() {
  const tbody=document.getElementById('membros-body');
  tbody.innerHTML='<tr><td colspan="4" style="text-align:center;padding:2rem;"><div class="loading-spinner" style="display:inline-block;"></div></td></tr>';
  try {
    const data=await apiGet('listar_membros');
    state.membrosAdmin=data.membros||[];
  } catch(e) {
    state.membrosAdmin=[{nick:state.nick,cargo:'Administrador',is_admin:true}];
  }
  const tbody2=document.getElementById('membros-body');
  if(!state.membrosAdmin.length){tbody2.innerHTML='<tr><td colspan="4" style="text-align:center;color:var(--text-dim);padding:2rem;">Nenhum membro</td></tr>';return;}
  tbody2.innerHTML=state.membrosAdmin.map((m,i)=>`
    <tr>
      <td style="font-family:'Share Tech Mono',monospace;font-size:12px;display:flex;align-items:center;gap:8px;">
        <img src="https://www.habbo.com.br/habbo-imaging/avatarimage?user=${encodeURIComponent(m.nick)}&headonly=1&size=s&direction=4&head_direction=4" style="width:20px;height:20px;image-rendering:pixelated;border-radius:2px;" onerror="this.style.display='none'">
        ${m.nick}
      </td>
      <td style="color:var(--text-dim);font-size:12px;">${m.cargo||'—'}</td>
      <td><span class="nota-badge ${m.is_admin?'nota-pendente':'nota-corrigido'}" style="font-size:10px;">${m.is_admin?'Admin':'Membro'}</span></td>
      <td><button class="btn-corrigir" onclick="editarMembro(${i})">Editar</button></td>
    </tr>
  `).join('');
}

function openAddMembroModal(m={},idx=null) {
  showModal(`
    <h3>${idx!==null?'Editar':'Adicionar'} Membro</h3>
    <div class="modal-field"><div class="modal-label">Nick (Habbo/Fórum)</div><input type="text" class="modal-input" id="m-nick" value="${m.nick||''}" placeholder="NickExato"></div>
    <div class="modal-field"><div class="modal-label">Cargo</div><input type="text" class="modal-input" id="m-cargo" value="${m.cargo||''}" placeholder="Ex: Soldado"></div>
    <div class="modal-field"><div class="modal-label">Permissões</div>
      <select class="modal-input" id="m-admin">
        <option value="0" ${!m.is_admin?'selected':''}>Membro</option>
        <option value="1" ${m.is_admin?'selected':''}>Administrador</option>
      </select>
    </div>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeModal()">Cancelar</button>
      <button class="btn-save gold" onclick="salvarMembro(${idx})">Salvar</button>
    </div>
  `);
}

function editarMembro(idx) { openAddMembroModal(state.membrosAdmin[idx],idx); }

async function salvarMembro(idx) {
  const dados={
    nick:document.getElementById('m-nick').value.trim(),
    cargo:document.getElementById('m-cargo').value.trim(),
    is_admin:document.getElementById('m-admin').value==='1',
    id:idx!==null?state.membrosAdmin[idx]?.id:null
  };
  if(!dados.nick){showToast('Nick obrigatório.','error');return;}
  try {
    await apiPost('salvar_membro',dados);
    showToast('Membro salvo!','success');
    closeModal();
    loadMembrosAdmin();
  } catch(e) {
    showToast('Erro ao salvar.','error');
  }
}

// ================================================================
// MODAL
// ================================================================
function showModal(html) {
  document.getElementById('modal-content').innerHTML=html;
  document.getElementById('modal-overlay').classList.add('open');
}
function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}
function closeModalOutside(e) {
  if(e.target===document.getElementById('modal-overlay')) closeModal();
}

// ================================================================
// TOAST
// ================================================================
function showToast(msg, type='success') {
  const container=document.getElementById('toast');
  const el=document.createElement('div');
  el.className='toast-item '+(type==='success'?'success':'error');
  el.innerHTML=`<span class="toast-dot ${type==='success'?'success':'error'}"></span>${msg}`;
  container.appendChild(el);
  setTimeout(()=>el.remove(),3500);
}

// ================================================================
// START
// ================================================================
initAuth();