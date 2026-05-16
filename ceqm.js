const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx7tI_gTVydkSd-IZXubIqvO8azZASKE97mW9b07VIaGkid0sUL3XuKP1T1YE-vvbAq/exec';

// ESTADO GLOBAL
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
    edicao_atual: '',
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

// AUTH — Forumeiros
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

// LOG AUTH
function addLog(msg) {
  const el=document.getElementById('auth-log');
  const div=document.createElement('div');
  div.textContent=msg;
  el.appendChild(div);
  el.scrollTop=el.scrollHeight;
}

// INIT AUTH
// AUTH — detecta automaticamente se está no fórum ou em ambiente de teste
async function initAuth() {
  addLog('Verificando sessão do fórum...');

  // Captura nick direto do Forumeiros
  let nick = null;
  try {
    const res = await fetch('/forum');
    const html = await res.text();
    const match = html.match(/_userdata\["username"\]\s*=\s*"([^"]+)"/);
    nick = match ? match[1] : null;
  } catch(e) {
    addLog('Erro ao ler sessão: ' + e.message);
  }

  // Se não está logado no fórum
  if (!nick || nick.toLowerCase() === 'anonymous') {
    document.getElementById('status-dot').classList.add('err');
    document.getElementById('status-text').textContent = 'Você não está logado no fórum!';
    document.getElementById('auth-denied').textContent = 'Faça login no fórum para acessar o CEQM.';
    document.getElementById('auth-denied').classList.remove('hidden');
    return;
  }

  addLog('Logado como: ' + nick);
  addLog('Verificando no sistema...');

  // Verifica/registra no Sheets
  try {
    const res = await apiGet('verificar_membro', { nick });
    state.nick = nick;
    state.isAdmin = !!res.is_admin;
    addLog(state.isAdmin ? 'Admin confirmado!' : 'Acesso liberado.');
  } catch(e) {
    // Sheets offline — entra pelo nick do fórum mesmo
    state.nick = nick;
    state.isAdmin = false;
    addLog('Sheets offline — entrando pelo nick do fórum.');
  }

  document.getElementById('status-dot').classList.add('ok');
  document.getElementById('status-text').textContent = 'Verificado — ' + state.nick;
  const btn = document.getElementById('btn-entrar');
  btn.classList.remove('hidden');
  btn.textContent = 'Entrar como ' + state.nick;
}

function entrarNoSistema() {
  document.getElementById('auth-screen').classList.add('hidden');
  const avatar = document.getElementById('avatar-img');
  avatar.src = `https://www.habbo.com.br/habbo-imaging/avatarimage?&user=${encodeURIComponent(state.nick)}&action=std&direction=4&head_direction=4&img_format=png&gesture=std&headonly=1&size=l`;
  document.getElementById('nick-name').textContent = state.nick;
  const avatarArea = document.getElementById('avatar-area');
  avatarArea.classList.remove('hidden');
  avatarArea.style.cursor = 'pointer';
  avatarArea.onclick = () => verPerfilProprio();
  document.getElementById('header-nav').classList.remove('hidden');
  if (state.isAdmin) {
    document.getElementById('admin-nav-btn')?.classList.remove('hidden');
    document.getElementById('drawerBtn-admin')?.classList.remove('hidden');
  }
  const drawerAvatar = document.getElementById('mob-drawer-avatar');
  const drawerNick   = document.getElementById('mob-drawer-nick');
  if (drawerAvatar) drawerAvatar.src = `https://www.habbo.com.br/habbo-imaging/avatarimage?user=${encodeURIComponent(state.nick)}&action=std&direction=4&head_direction=4&img_format=png&gesture=std&headonly=1&size=b`;
  if (drawerNick)   drawerNick.textContent = state.nick;
  const greet = document.getElementById('hero-greeting');
  const hour  = new Date().getHours();
  if (greet) greet.textContent = hour < 12 ? 'Bom dia, ' + state.nick : hour < 18 ? 'Boa tarde, ' + state.nick : 'Boa noite, ' + state.nick;
  const tw = document.getElementById('typewriter-text');
  if (tw && typeof runTypewriter === 'function') {
    runTypewriter(tw, ['treinar agora?', 'passar na AQOI?', 'evoluir hoje?'], 80, 2400);
  }
  showScreen('home');
  loadConfig();
  loadUserStats();
}

// ================================================================
// API CALLS
// ================================================================
async function apiGet(action, params={}) {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set('action', action);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url.toString(), { method: 'GET', redirect: 'follow' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// Apps Script não suporta CORS em POST — enviamos tudo via GET com payload encodado
async function apiPost(action, data={}) {
  // Comprime as respostas antes de enviar para não estourar o limite de URL
  const payload = { action, ...data };
  if (payload.respostas) {
    payload.respostas = payload.respostas.map(r => ({
      pergunta_id: r.pergunta_id,
      documento:   r.documento,
      resposta:    r.resposta,
      // Omite pergunta e gabarito completos — o AS já tem no banco
    }));
  }
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set('action', 'post');
  url.searchParams.set('data', encodeURIComponent(JSON.stringify(payload)));
  const res = await fetch(url.toString(), { method: 'GET', redirect: 'follow' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// ================================================================
// SCREENS
// ================================================================
const screens=['auth-screen','home-screen','simulado-screen','result-screen','admin-screen','hall-screen','minha-prova-screen','ranking-screen','perfil-screen'];
function showScreen(name) {
  screens.forEach(s=>{
    const el=document.getElementById(s);
    if(el) el.classList.add('hidden');
  });
  const target=document.getElementById(name+'-screen');
  if(target) target.classList.remove('hidden');

  document.querySelectorAll('.nav-btn:not(.admin-btn)').forEach(b=>b.classList.remove('active'));
  if(name==='home') document.querySelector('.nav-btn:first-child')?.classList.add('active');
  if(name==='hall') renderHall();
  if(name==='minha-prova') loadMinhaProva();
  if(name==='ranking') loadRanking();
  setDrawerActive(name);
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
    <div class="stat-box"><div class="stat-num" style="font-size:20px;">${c.edicao_atual||'—'}</div><div class="stat-label">Edição atual</div></div>
    <div class="stat-box"><div class="stat-num">${c.qtd_ccm_cpm}</div><div class="stat-label">CCM/CPM</div></div>
    <div class="stat-box"><div class="stat-num">${c.qtd_ccb}</div><div class="stat-label">CCB</div></div>
    <div class="stat-box"><div class="stat-num">${c.qtd_pce}</div><div class="stat-label">PCE</div></div>
  `;
  const tog=document.getElementById('toggle-real');
  if(tog) tog.className='toggle-switch'+(c.simulado_real_ativo?' on':'');
}

function updateRealMode() {
  const card=document.getElementById('real-mode-card');
  const badge=document.getElementById('real-badge');
  const navBtn=document.getElementById('real-nav-btn');
  if(!card) return;
  if(state.config.simulado_real_ativo) {
    card.classList.remove('locked');
    card.classList.add('available');
    badge.className='bento-badge badge-open';
    badge.innerHTML='<span class="dot-badge dot-open"></span>Disponível';
    navBtn.style.color='';
  } else {
    card.classList.add('locked');
    card.classList.remove('available');
    badge.className='bento-badge badge-locked';
    badge.innerHTML='<span class="dot-badge dot-locked"></span>Bloqueado';
  }
}

async function loadUserStats() {
  try {
    const data=await apiGet('stats_usuario',{nick:state.nick});
    setTimeout(()=>{
      if(typeof animateCounter==='function') {
        animateCounter(document.getElementById('stat-treinos'),data.treinos||0,'',1000);
        animateCounter(document.getElementById('stat-acertos'),(data.taxa_acerto||0)+'%','',1100);
        animateCounter(document.getElementById('stat-reais'),data.reais||0,'',1000);
        const nota=data.ultima_nota;
        const notaEl=document.getElementById('stat-nota');
        if(nota){animateCounter(notaEl,nota,'',1000);}else{notaEl.textContent='—';notaEl.classList.remove('shimmer-active');}
      } else {
        document.getElementById('stat-treinos').textContent=data.treinos||'0';
        document.getElementById('stat-acertos').textContent=(data.taxa_acerto||0)+'%';
        document.getElementById('stat-reais').textContent=data.reais||'0';
        document.getElementById('stat-nota').textContent=data.ultima_nota||'—';
      }
    },400);
  } catch(e) {
    ['stat-treinos','stat-acertos','stat-reais','stat-nota'].forEach(id=>{
      const el=document.getElementById(id);
      if(el){el.textContent='—';el.classList.remove('shimmer-active');}
    });
  }
}

// ================================================================
// SIMULADO — CORE
// ================================================================

// Destaca pontuações no gabarito: (0,10) (0,20) etc → badge verde
function highlightPontuacao(texto) {
  return texto.replace(/\((\d+[.,]\d+)\)/g,
    '<span class="pont-badge">($1)</span>');
}

// Verifica 1-passe do simulado real — apenas via Sheets
async function verificarPasse() {
  try {
    const res = await apiGet('verificar_passe', { nick: state.nick });
    return !res.ja_iniciou; // true = pode iniciar
  } catch(e) {
    // Se Sheets offline, permitir (não punir o aluno por instabilidade)
    return true;
  }
}

async function marcarPasse() {
  try {
    await apiPost('marcar_passe', { nick: state.nick, ts: Date.now() });
  } catch(e) {}
}

async function tentarReal() {
  if (!state.config.simulado_real_ativo) {
    showToast('O simulado real está bloqueado no momento.', 'error');
    return;
  }
  const podeIniciar = await verificarPasse();
  if (!podeIniciar) {
    showModal(`
      <h3>Acesso negado</h3>
      <p style="color:var(--c3);font-size:14px;line-height:1.7;margin-bottom:1.5rem;">
        Você já iniciou o Simulado Real. Cada participante tem apenas <strong style="color:var(--c1)">1 tentativa</strong>.<br>
        Suas respostas foram registradas e serão corrigidas pelos admins.
      </p>
      <div class="modal-actions"><button class="btn-cancel" onclick="closeModal()">Fechar</button></div>
    `);
    return;
  }
  // Confirmar antes de usar o passe
  showModal(`
    <h3>Iniciar Simulado Real</h3>
    <div style="background:rgba(255,159,10,.08);border:1px solid rgba(255,159,10,.2);border-radius:10px;padding:1rem 1.25rem;margin-bottom:1.5rem;">
      <div style="font-size:13px;color:#ff9f0a;font-weight:600;margin-bottom:.4rem;">⚠ Atenção — leia antes de iniciar</div>
      <div style="font-size:13px;color:var(--c3);line-height:1.7;">
        Você possui <strong style="color:var(--c1)">1 única tentativa</strong>. Ao confirmar:<br>
        • O timer por questão começa imediatamente<br>
        • Sair ou fechar o navegador consome a tentativa<br>
        • Sem gabarito durante a prova — correção feita pelos admins
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeModal()">Cancelar</button>
      <button class="btn-save" style="background:rgba(255,159,10,.2);color:#ff9f0a;border:1px solid rgba(255,159,10,.4);" onclick="closeModal();startSimulado('real')">Confirmar e iniciar</button>
    </div>
  `);
}

async function startSimulado(tipo) {
  state.simuladoTipo = tipo;
  state.respostas    = [];
  state.currentQ     = 0;

  if (tipo === 'real') marcarPasse();

  showScreen('simulado');
  document.getElementById('sim-title').textContent = tipo === 'treino' ? 'Simulado Treino' : 'Simulado Real';
  const badge = document.getElementById('sim-badge');
  badge.textContent  = tipo === 'treino' ? 'Treino' : 'Real';
  badge.className    = 'sim-badge ' + (tipo === 'treino' ? 'treino' : 'real');
  document.getElementById('question-area').innerHTML =
    '<div style="display:flex;align-items:center;justify-content:center;min-height:300px;"><div class="loading-spinner"></div></div>';

  try {
    const data = await apiGet(tipo === 'treino' ? 'perguntas_treino' : 'perguntas_real', { nick: state.nick });
    state.perguntas = data.perguntas || [];
  } catch(e) {
    state.perguntas = getDemoPerguntas(tipo);
  }

  if (!state.perguntas.length) {
    document.getElementById('question-area').innerHTML =
      '<div style="text-align:center;padding:3rem;color:var(--c4);">Nenhuma pergunta disponível.</div>';
    return;
  }

  document.getElementById('q-total').textContent = state.perguntas.length;
  renderQuestion();
}

// ── POR QUESTÃO ──────────────────────────────────────────────────
function renderQuestion() {
  const q = state.perguntas[state.currentQ];
  if (!q) { finalizarSimulado(); return; }

  const prog = ((state.currentQ + 1) / state.perguntas.length * 100).toFixed(0);
  document.getElementById('progress-fill').style.width = prog + '%';
  document.getElementById('q-current').textContent = state.currentQ + 1;

  clearInterval(state.timerInterval);
  state.timerLeft = q.tempo || 120;

  const docClass = { CCM:'doc-ccm', CPM:'doc-cpm', PCE:'doc-pce', CCB:'doc-ccb' }[q.documento] || 'doc-ccm';

  document.getElementById('question-area').innerHTML = `
    <div class="question-card" id="q-card" style="animation:fadeUp .3s both;">
      <div class="q-meta">
        <div class="q-num">Q${String(state.currentQ+1).padStart(2,'0')}</div>
        <div class="q-doc-badge ${docClass}">${q.documento}</div>
        ${state.simuladoTipo === 'real' ? '<div class="q-timer" id="q-timer">--:--</div>' : ''}
      </div>
      <div class="q-text">${q.pergunta}</div>
      <textarea class="q-textarea" id="q-resposta"
        placeholder="Escreva sua resposta aqui..."
        maxlength="3000"></textarea>
      <div class="q-actions">
        <div class="char-count"><span id="char-n">0</span> / 3000</div>
        <button class="btn-confirm" id="btn-proxima" onclick="proximaPergunta()">
          ${state.currentQ + 1 < state.perguntas.length ? 'Próxima →' : 'Finalizar'}
        </button>
      </div>
    </div>
  `;

  document.getElementById('q-resposta').addEventListener('input', e => {
    document.getElementById('char-n').textContent = e.target.value.length;
  });

  if (state.simuladoTipo === 'real') startTimer(q.tempo || 150);
}

function startTimer(segundos) {
  state.timerLeft = segundos;
  updateTimerDisplay();
  state.timerInterval = setInterval(() => {
    state.timerLeft--;
    updateTimerDisplay();
    if (state.timerLeft <= 0) {
      clearInterval(state.timerInterval);
      proximaPergunta();
    }
  }, 1000);
}

function updateTimerDisplay() {
  const el = document.getElementById('q-timer');
  if (!el) return;
  const m = Math.floor(state.timerLeft / 60);
  const s = state.timerLeft % 60;
  el.textContent = String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
  el.className = 'q-timer';
  if (state.timerLeft <= 30) el.classList.add('warning');
  if (state.timerLeft <= 10) el.classList.add('danger');
}

function proximaPergunta() {
  clearInterval(state.timerInterval);
  const q    = state.perguntas[state.currentQ];
  const resp = document.getElementById('q-resposta')?.value || '';
  state.respostas.push({
    pergunta_id: q.id,
    pergunta:    q.pergunta,
    documento:   q.documento,
    resposta:    resp,
    gabarito:    q.gabarito || '',
    pontuacao:   null  
  });
  state.currentQ++;
  if (state.currentQ >= state.perguntas.length) finalizarSimulado();
  else renderQuestion();
}

// ── FINALIZAR ────────────────────────────────────────────────────
async function finalizarSimulado() {
  clearInterval(state.timerInterval);
  try {
    await apiPost(state.simuladoTipo === 'treino' ? 'salvar_treino' : 'salvar_real', {
      nick: state.nick, respostas: state.respostas, tipo: state.simuladoTipo,
      edicao: state.config.edicao_atual || ''
    });
  } catch(e) {}

  if (state.simuladoTipo === 'treino') {
    renderRevisaoTreino();
  } else {
    showScreen('result');
    renderResultReal();
  }
}

// ── REVISÃO TREINO (gabarito no final) ───────────────────────────
function renderRevisaoTreino() {
  showScreen('result');
  const container = document.getElementById('result-stats');
  const title     = document.getElementById('result-title');
  const sub       = document.getElementById('result-sub');

  title.textContent = 'Revisão do Treino';
  sub.textContent   = 'Confira o gabarito de cada questão e marque sua pontuação.';

  // Área de revisão — substitui o result-stats por layout completo
  container.style.display = 'none';
  document.querySelector('.result-actions').style.display = 'none';

  // Inserir revisão após o result-sub
  let revisaoEl = document.getElementById('revisao-area');
  if (!revisaoEl) {
    revisaoEl = document.createElement('div');
    revisaoEl.id = 'revisao-area';
    document.querySelector('.result-screen').appendChild(revisaoEl);
  }

  revisaoEl.innerHTML = state.respostas.map((r, i) => {
    const docClass = { CCM:'doc-ccm', CPM:'doc-cpm', PCE:'doc-pce', CCB:'doc-ccb' }[r.documento] || 'doc-ccm';
    return `
    <div class="revisao-card" id="rev-card-${i}">
      <div class="revisao-header">
        <span class="q-doc-badge ${docClass}">${r.documento}</span>
        <span class="revisao-qnum">Questão ${i+1}</span>
        <div class="revisao-pont-display" id="pont-display-${i}">—</div>
      </div>
      <div class="revisao-pergunta">${r.pergunta}</div>
      <div class="revisao-cols">
        <div class="revisao-col">
          <div class="revisao-col-label">Sua resposta</div>
          <div class="revisao-col-text">${r.resposta || '<span style="opacity:.4;font-style:italic;">Sem resposta</span>'}</div>
        </div>
        <div class="revisao-col">
          <div class="revisao-col-label">Gabarito</div>
          <div class="revisao-col-text gabarito-col">${highlightPontuacao(r.gabarito || 'Gabarito não disponível.')}</div>
        </div>
      </div>
      <div class="revisao-pont-row">
        <span style="font-size:12px;color:var(--c4);">Minha pontuação nesta questão:</span>
        <input type="number" class="pont-input" id="pont-${i}"
          min="0" max="10" step="0.1" placeholder="0.0"
          oninput="atualizarPontuacao(${i})"
          style="width:72px;">
      </div>
    </div>
    `;
  }).join('') + `
  <div class="revisao-total-card" id="revisao-total">
    <div class="revisao-total-label">Nota total</div>
    <div class="revisao-total-num" id="nota-total">0.0</div>
    <div class="revisao-total-sub">/ ${state.respostas.length * 1} pontos possíveis</div>
  </div>
  <div style="display:flex;gap:.75rem;justify-content:center;margin-top:2rem;flex-wrap:wrap;">
    <button class="btn-confirm" onclick="startSimulado('treino')">Novo treino</button>
    <button class="btn-secondary" onclick="voltarHome()">Voltar ao início</button>
  </div>`;
}

function atualizarPontuacao(idx) {
  const val = parseFloat(document.getElementById('pont-' + idx)?.value) || 0;
  state.respostas[idx].pontuacao = val;
  document.getElementById('pont-display-' + idx).textContent = val.toFixed(1);

  // Atualizar total
  const total = state.respostas.reduce((acc, r) => acc + (r.pontuacao || 0), 0);
  const notaEl = document.getElementById('nota-total');
  if (notaEl) {
    notaEl.textContent = total.toFixed(1);
    notaEl.style.color = total >= 7 ? 'var(--green)' : total >= 5 ? '#ff9f0a' : '#ff453a';
  }
}

function voltarHome() {
  // Limpar área de revisão
  const rev = document.getElementById('revisao-area');
  if (rev) rev.remove();
  const stats = document.getElementById('result-stats');
  if (stats) stats.style.display = '';
  const actions = document.querySelector('.result-actions');
  if (actions) actions.style.display = '';
  showScreen('home');
}

// ── RESULT REAL ──────────────────────────────────────────────────
function renderResultReal() {
  document.getElementById('result-title').textContent = 'Prova Enviada';
  document.getElementById('result-sub').textContent   = 'Suas respostas foram registradas. Aguarde a correção dos admins.';
  document.getElementById('result-stats').innerHTML = `
    <div class="result-stat" style="grid-column:1/-1">
      <div class="result-stat-n" style="color:#ff9f0a;">${state.respostas.length}</div>
      <div class="result-stat-l">Respostas enviadas</div>
    </div>`;
  document.querySelector('.result-actions').innerHTML = `
    <button class="btn-secondary" onclick="showScreen('home')">Voltar ao início</button>`;
}

function confirmBack() {
  if (state.simuladoTipo === 'real') {
    showModal(`
      <h3>Sair da prova?</h3>
      <p style="color:var(--c3);font-size:14px;line-height:1.7;margin-bottom:1.5rem;">
        Você está no <strong style="color:var(--c1)">Simulado Real</strong>.<br>
        Sair agora <strong style="color:#ff453a">consome sua única tentativa</strong> e suas respostas até aqui serão salvas.
      </p>
      <div class="modal-actions">
        <button class="btn-cancel" onclick="closeModal()">Continuar prova</button>
        <button class="btn-save" style="background:rgba(255,69,58,.2);color:#ff453a;border:1px solid rgba(255,69,58,.4);"
          onclick="closeModal();clearInterval(state.timerInterval);finalizarSimulado()">Sair e enviar respostas</button>
      </div>
    `);
  } else {
    if (confirm('Sair do treino? O progresso será perdido.')) {
      clearInterval(state.timerInterval);
      const rev = document.getElementById('revisao-area');
      if (rev) rev.remove();
      showScreen('home');
    }
  }
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



// ================================================================
// ADMIN
// ================================================================
function switchAdminTab(tab) {
  if (!state.isAdmin) return;
  state.adminTab = tab;
  const tabs = ['controle','simulado-real','correcoes','perguntas','membros','passes','emblemas'];
  document.querySelectorAll('.admin-tab').forEach((t, i) => {
    t.className = 'admin-tab' + (tabs[i] === tab ? ' active' : '');
  });
  tabs.forEach(t => {
    document.getElementById('tab-' + t)?.classList.toggle('hidden', t !== tab);
  });
  if (tab === 'simulado-real') loadSimuladoRealAdmin();
  if (tab === 'correcoes')     loadCorrecoes();
  if (tab === 'perguntas')     loadPerguntasAdmin();
  if (tab === 'membros')       loadMembrosAdmin();
  if (tab === 'passes')        loadPassesAdmin();
  if (tab === 'emblemas')      initEmblemasAdmin();
}

async function toggleSimuladoReal() {
  const novo = !state.config.simulado_real_ativo;
  try {
    await apiPost('toggle_real', { ativo: novo, admin_nick: state.nick });
  } catch(e) {}
  state.config.simulado_real_ativo = novo;
  renderConfig();
  updateRealMode();
  atualizarBadgeSR();
  showToast('Simulado real ' + (novo ? 'liberado! 🟢' : 'bloqueado.'), novo ? 'success' : 'success');
}

function atualizarBadgeSR() {
  const badge  = document.getElementById('sr-status-badge');
  const btnSR  = document.getElementById('btn-toggle-sr');
  if (!badge) return;
  if (state.config.simulado_real_ativo) {
    badge.className = 'bento-badge badge-open';
    badge.innerHTML = '<span class="dot-badge dot-open"></span>Liberado';
    if (btnSR) btnSR.textContent = 'Bloquear prova';
  } else {
    badge.className = 'bento-badge badge-locked';
    badge.innerHTML = '<span class="dot-badge dot-locked"></span>Bloqueado';
    if (btnSR) btnSR.textContent = 'Liberar prova';
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
    <div class="modal-field" style="margin-top:.75rem;">
      <div class="modal-label">Edição atual (ex: 2026.1)</div>
      <input type="text" class="modal-input" id="cfg-edicao" value="${c.edicao_atual||''}">
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
    edicao_atual:document.getElementById('cfg-edicao').value.trim(),
  };
  try {
    await apiPost('salvar_config', { ...cfg, admin_nick: state.nick });
  } catch(e) {}
  Object.assign(state.config,cfg);
  renderConfig();
  closeModal();
  showToast('Configuração salva!','success');
}

async function loadCorrecoes() {
  const grid = document.getElementById('correcoes-candidatos-grid');
  const select = document.getElementById('filtro-edicao-correcao');
  if (!grid) return;
  grid.innerHTML = '<div style="text-align:center;padding:2rem;"><div class="loading-spinner" style="display:inline-block;"></div></div>';
  try {
    const edicaoFiltro = select?.value || '';
    const data = await apiGet('candidatos_real', edicaoFiltro ? { edicao: edicaoFiltro } : {});
    // Popular filtro de edições
    if (select && data.edicoes) {
      const valorAtual = select.value;
      select.innerHTML = '<option value="">Todas as edições</option>' +
        data.edicoes.map(e => `<option value="${e}" ${e===valorAtual?'selected':''}>${e}</option>`).join('');
    }
    const candidatos = data.candidatos || [];
    if (!candidatos.length) {
      grid.innerHTML = '<div style="text-align:center;color:var(--c4);padding:2rem;">Nenhuma resposta recebida ainda.</div>';
      return;
    }
    // Agrupar por edição
    const porEdicao = {};
    candidatos.forEach(c => {
      if (!porEdicao[c.edicao]) porEdicao[c.edicao] = [];
      porEdicao[c.edicao].push(c);
    });
    grid.innerHTML = Object.entries(porEdicao).map(([edicao, lista]) => `
      <div style="margin-bottom:1rem;">
        <div style="font-size:11px;font-weight:700;color:var(--c4);letter-spacing:.4px;text-transform:uppercase;margin-bottom:.5rem;padding:0 2px;">
          Edição ${edicao}
        </div>
        ${lista.map(c => {
          const cor = c.status==='corrigido'?'var(--green)':c.status==='parcial'?'#ff9f0a':'var(--c4)';
          const icone = c.status==='corrigido'?'✓':c.status==='parcial'?'◑':'○';
          return `<div style="display:flex;align-items:center;gap:.875rem;padding:.875rem 1rem;background:var(--bg-deep);border:1px solid var(--border);border-radius:10px;cursor:pointer;transition:border-color .15s;"
            onclick="abrirProvaCandiato('${c.nick}','${c.edicao}')"
            onmouseover="this.style.borderColor='var(--border-m)'" onmouseout="this.style.borderColor='var(--border)'">
            <img src="https://www.habbo.com.br/habbo-imaging/avatarimage?user=${encodeURIComponent(c.nick)}&headonly=1&size=s&direction=4&head_direction=4"
              style="width:32px;height:32px;border-radius:50%;border:1.5px solid var(--border-m);image-rendering:pixelated;" onerror="this.style.display='none'">
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:600;color:var(--c1);">${c.nick}</div>
              <div style="font-size:11px;color:var(--c4);margin-top:2px;">${c.corrigidas}/${c.total_respostas} corrigidas${c.nota_total ? ' · Nota: '+c.nota_total : ''}</div>
            </div>
            <div style="font-size:13px;font-weight:700;color:${cor};">${icone}</div>
          </div>`;
        }).join('')}
      </div>
    `).join('');
  } catch(e) {
    grid.innerHTML = '<div style="text-align:center;color:var(--c4);padding:2rem;">Erro ao carregar.</div>';
  }
}

async function abrirProvaCandiato(nick, edicao) {
  document.getElementById('correcoes-lista-view').classList.add('hidden');
  document.getElementById('correcoes-prova-view').classList.remove('hidden');
  document.getElementById('correcoes-candidato-titulo').textContent = nick;
  document.getElementById('correcoes-candidato-edicao').textContent = edicao && edicao !== '—' ? 'Edição ' + edicao : 'Edição não identificada';
  const body = document.getElementById('correcoes-prova-body');
  body.innerHTML = '<div style="display:flex;justify-content:center;padding:2rem;"><div class="loading-spinner"></div></div>';
  try {
    const data = await apiGet('respostas_real', { nick });
    const respostas = (data.respostas || []).filter(r => String(r.edicao ?? '—') === String(edicao));
    window._correcaoAtualNick = nick;
    window._correcaoAtualEdicao = edicao;
    window._respostasAbertas = respostas;
    const docClass = { CCM:'doc-ccm', CPM:'doc-cpm', PCE:'doc-pce', CCB:'doc-ccb' };
    body.innerHTML = respostas.map((r, i) => `
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:1.5rem;" id="corr-card-${i}">
        <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:1rem;">
          <span class="q-doc-badge ${docClass[r.documento]||'doc-ccm'}">${r.documento}</span>
          <span style="font-size:12px;color:var(--c4);">Questão ${i+1}</span>
          ${r.corrigido ? `<span class="nota-badge nota-corrigido" style="margin-left:auto;">${r.nota} pts</span>` : '<span class="nota-badge nota-pendente" style="margin-left:auto;">Pendente</span>'}
        </div>
        <div style="font-size:13px;color:var(--c3);margin-bottom:.75rem;line-height:1.6;">${r.pergunta||''}</div>
        <div style="font-size:11px;font-weight:600;color:var(--c4);text-transform:uppercase;letter-spacing:.3px;margin-bottom:.4rem;">Resposta do candidato</div>
        <div style="background:var(--bg-deep);border-radius:8px;padding:10px 12px;font-size:13px;color:var(--c2);line-height:1.6;min-height:48px;margin-bottom:1rem;border:1px solid var(--border);white-space:pre-wrap;word-break:break-word;max-height:300px;overflow-y:auto;">
          ${r.resposta || '<em style="opacity:.4;">Sem resposta</em>'}
        </div>
        <div style="margin-bottom:.75rem;">
          <div style="font-size:11px;font-weight:600;color:var(--c4);text-transform:uppercase;letter-spacing:.3px;margin-bottom:.5rem;">Gabarito / Feedback</div>
          <div class="gab-editor-wrap">
            <div class="gab-toolbar">
              <span class="gab-toolbar-label">Peso:</span>
              ${['0,10','0,15','0,20','0,25','0,30','0,40','0,50'].map(p =>
                `<button class="gab-pont-btn" onclick="gabAplicarPesoEm('corr-gab-${i}','(${p})')">(${p})</button>`
              ).join('')}
              <button class="gab-clear-btn" onclick="gabLimparFormatoEm('corr-gab-${i}')">✕ Limpar</button>
            </div>
            <div class="gab-editor" id="corr-gab-${i}"
              contenteditable="true"
              data-placeholder="Escreva o gabarito. Selecione um trecho e clique no peso para destacar..."
            >${r.gabarito ? gabHtmlParaEditor(r.gabarito) : ''}</div>
          </div>
        </div>
        <div style="margin-bottom:.75rem;">
          <div style="font-size:11px;font-weight:600;color:var(--c4);text-transform:uppercase;letter-spacing:.3px;margin-bottom:.5rem;">Comentário ao aluno</div>
          <textarea class="modal-input" id="com-${i}" style="min-height:60px;" placeholder="Feedback para o candidato (opcional)">${r.comentario||''}</textarea>
        </div>
        <div style="display:flex;align-items:center;gap:.75rem;">
          <label style="font-size:11px;font-weight:600;color:var(--c4);text-transform:uppercase;letter-spacing:.3px;">Nota (0–1,00)</label>
          <input type="number" class="modal-input" id="nota-${i}" value="${r.nota||''}" min="0" max="1" step="0.05" style="width:90px;" placeholder="0.80">
        </div>
        <input type="hidden" id="respid-${i}" value="${r.id}">
      </div>
    `).join('') || '<div style="text-align:center;color:var(--c4);padding:2rem;">Nenhuma resposta encontrada para esta edição.</div>';
  } catch(e) {
    body.innerHTML = '<div style="text-align:center;color:var(--c4);padding:2rem;">Erro ao carregar.</div>';
  }
}

function voltarListaCandidatos() {
  document.getElementById('correcoes-lista-view').classList.remove('hidden');
  document.getElementById('correcoes-prova-view').classList.add('hidden');
}

async function salvarTodasCorrecoes() {
  const respostas = window._respostasAbertas || [];
  if (!respostas.length) return;
  let salvos = 0;
  for (let i = 0; i < respostas.length; i++) {
    const id = document.getElementById('respid-'+i)?.value;
    const nota = document.getElementById('nota-'+i)?.value;
    const gabarito = gabEditorParaTextoEm('corr-gab-'+i);
    const comentario = document.getElementById('com-'+i)?.value || '';
    if (!nota && nota !== '0') continue;
    try {
      await apiPost('corrigir', { id, nota, gabarito, comentario, nick: state.nick });
      salvos++;
    } catch(e) {}
  }
  showToast(`${salvos} correção(ões) salva(s)!`);
  // Recarregar a prova para atualizar status
  await abrirProvaCandiato(window._correcaoAtualNick, window._correcaoAtualEdicao);
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
  if(!lista.length){tbody.innerHTML='<tr><td colspan="5" style="text-align:center;color:var(--c4);padding:2rem;">Nenhuma pergunta</td></tr>';return;}
  tbody.innerHTML=lista.map((q,i)=>`
    <tr>
      <td><span class="q-doc-badge ${docClass(q.documento)}">${q.documento}</span></td>
      <td><span class="nota-badge ${q.tipo==='real'?'nota-pendente':'nota-corrigido'}">${q.tipo||'treino'}</span></td>
      <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--c3);font-size:13px;" title="${q.pergunta}">${q.pergunta}</td>
      <td style="font-size:13px;color:var(--c4);">${q.tempo||q.tempo_s||'—'}s</td>
      <td><button class="btn-sm" onclick="editarPergunta(${i})">Editar</button></td>
    </tr>
  `).join('');
}

function openAddPerguntaModal(q={}, idx=null) {
  const pesos = ['0,10','0,15','0,20','0,25','0,30','0,40','0,50'];
  showModal(`
    <h3>${idx!==null?'Editar':'Nova'} Pergunta — Treino</h3>
    <div class="q-form-grid">
      <div class="form-group"><label>Documento</label>
        <select class="modal-input" id="p-doc">
          ${['CCM','CPM','CCB','PCE'].map(d=>`<option ${(q.documento||'CCM')===d?'selected':''}>${d}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Tempo (segundos)</label>
        <input type="number" class="modal-input" id="p-tempo" value="${q.tempo||q.tempo_s||120}" min="30">
      </div>
    </div>
    <div class="modal-field"><div class="modal-label">Pergunta</div>
      <textarea class="modal-input" id="p-pergunta" style="min-height:80px;">${q.pergunta||''}</textarea>
    </div>
    <div class="modal-field">
      <div class="modal-label">Gabarito — selecione o texto e clique no peso</div>
      <div class="gab-editor-wrap">
        <div class="gab-toolbar">
          <span class="gab-toolbar-label">Peso:</span>
          ${pesos.map(p => `<button class="gab-pont-btn" onclick="gabAplicarPesoTreino('(${p})')">(${p})</button>`).join('')}
          <button class="gab-clear-btn" onclick="gabLimparFormatoTreino()">✕ Limpar</button>
        </div>
        <div class="gab-editor" id="p-gabarito-editor"
          contenteditable="true"
          data-placeholder="Escreva o gabarito. Selecione um trecho e clique no peso para destacar..."
        >${q.gabarito ? gabHtmlParaEditor(q.gabarito) : ''}</div>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeModal()">Cancelar</button>
      <button class="btn-save" onclick="salvarPergunta(${idx})">Salvar Pergunta</button>
    </div>
  `);
}

function gabAplicarPesoTreino(peso) { gabAplicarPesoEm('p-gabarito-editor', peso); }
function gabLimparFormatoTreino()   { gabLimparFormatoEm('p-gabarito-editor'); }
function gabAplicarPeso(peso)        { gabAplicarPesoEm('srp-gabarito-editor', peso); }
function gabLimparFormato()          { gabLimparFormatoEm('srp-gabarito-editor'); }

function gabAplicarPesoEm(editorId, peso) {
  const editor = document.getElementById(editorId);
  if (!editor) return;
  editor.focus();
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  const textoSel = range.toString().trim();
  const badge = document.createElement('span');
  badge.className = 'pont-badge';
  badge.contentEditable = 'false';
  badge.textContent = textoSel ? textoSel + ' ' + peso : peso;
  range.deleteContents();
  range.insertNode(badge);
  range.setStartAfter(badge);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function gabLimparFormatoEm(editorId) {
  const editor = document.getElementById(editorId);
  if (!editor) return;
  editor.querySelectorAll('.pont-badge').forEach(b => {
    b.replaceWith(document.createTextNode(b.textContent));
  });
}

function gabEditorParaTextoEm(editorId) {
  const el = document.getElementById(editorId);
  if (!el) return '';
  const clone = el.cloneNode(true);
  clone.querySelectorAll('.pont-badge').forEach(b => {
    b.replaceWith(document.createTextNode(b.textContent));
  });
  return (clone.innerText || clone.textContent || '').trim();
}

function editarPergunta(idx) {
  openAddPerguntaModal(state.perguntasAdmin[idx],idx);
}

async function salvarPergunta(idx) {
  const gabarito = gabEditorParaTextoEm('p-gabarito-editor');
  const dados={
    documento: document.getElementById('p-doc').value,
    tipo:      'treino',
    pergunta:  document.getElementById('p-pergunta').value,
    gabarito:  gabarito,
    tempo:     +document.getElementById('p-tempo').value,
    id:        idx!==null ? state.perguntasAdmin[idx]?.id : null
  };
  if(!dados.pergunta.trim()){showToast('Escreva a pergunta.','error');return;}
  try {
    await apiPost('salvar_pergunta', { ...dados, admin_nick: state.nick });
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
  if(!state.membrosAdmin.length){tbody2.innerHTML='<tr><td colspan="4" style="text-align:center;color:var(--c4);padding:2rem;">Nenhum membro</td></tr>';return;}
  tbody2.innerHTML=state.membrosAdmin.map((m,i)=>`
    <tr>
      <td style="font-size:13px;font-weight:500;display:flex;align-items:center;gap:8px;">
        <img src="https://www.habbo.com.br/habbo-imaging/avatarimage?user=${encodeURIComponent(m.nick)}&headonly=1&size=s&direction=4&head_direction=4" style="width:22px;height:22px;image-rendering:pixelated;border-radius:50%;border:1px solid var(--border);" onerror="this.style.display='none'">
        ${m.nick}
      </td>
      <td style="color:var(--c4);font-size:13px;">${m.cargo||'—'}</td>
      <td><span class="nota-badge ${m.is_admin?'nota-pendente':'nota-corrigido'}">${m.is_admin?'Admin':'Membro'}</span></td>
      <td><button class="btn-sm" onclick="editarMembro(${i})">Editar</button></td>
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
    await apiPost('salvar_membro', { ...dados, admin_nick: state.nick });
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

// ================================================================
// EMBLEMAS
// ================================================================
const EMBLEMAS_DEF = {
  admin:    { url:'https://images.habbo.com/c_images/album1584/RDC13.png', nome:'Administrador' },
  real_1:   { url:'https://images.habbo.com/c_images/album1584/X2521.png', nome:'Realizou 1 Simulado Real' },
  real_5:   { url:'https://images.habbo.com/c_images/album1584/OHC25.png', nome:'Realizou 5 Simulados Reais' },
  treino_1: { url:'https://images.habbo.com/c_images/album1584/HPP11.png', nome:'Realizou 1 Simulado Treino' },
  treino_5: { url:'https://images.habbo.com/c_images/album1584/HPP25.png', nome:'Realizou 5 Simulados Treino' },
  fome:     { url:'https://images.habbo.com/c_images/album1584/US618.png', nome:'Tô Sempre com Fome' },
  artista:  { url:'https://images.habbo.com/c_images/album1584/US612.png', nome:'Artista' },
  rainha:   { url:'https://images.habbo.com/c_images/album1584/ALW16.png', nome:'Rainha' },
  dono:     { url:'https://images.habbo.com/c_images/album1584/ALW17.png', nome:'Dono/Dona' },
  developer:{ url:'https://images.habbo.com/c_images/album1584/V2012.png', nome:'Developer' },
};
const EMBLEMAS_MANUAIS = ['fome','artista','rainha','dono','developer'];

// ================================================================
// PERFIL
// ================================================================
const EMBLEMAS_DESC = {
  admin:    'Membro da administração.',
  real_1:   'Participou de pelo menos 1 Simulado Real.',
  real_5:   'Veterano — 5 ou mais Simulados Reais.',
  treino_1: 'Realizou o primeiro Simulado Treino.',
  treino_5: 'Dedicado — 5 ou mais treinos realizados.',
  fome:     'Sempre aparece... provavelmente com fome.',
  artista:  'Reconhecido pela criatividade e talento.',
  rainha:   'A rainha. Não precisa de mais explicação.',
  dono:     'Fundador ou figura central da corporação.',
  developer:'Responsável pelo desenvolvimento do CEQM.',
};

function renderEmblemas(emblemas) {
  if (!emblemas || !emblemas.length) return '<div style="font-size:12px;color:var(--c4);">Nenhum emblema ainda.</div>';
  return emblemas.map(id => {
    const e = EMBLEMAS_DEF[id];
    if (!e) return '';
    return `<div class="emblema-item">
      <img src="${e.url}" alt="${e.nome}">
      <div class="emblema-tooltip">
        <div class="emblema-tooltip-nome">${e.nome}</div>
        <div class="emblema-tooltip-desc">${EMBLEMAS_DESC[id]||''}</div>
      </div>
    </div>`;
  }).join('');
}

let _perfilAnterior = 'home';

async function abrirPerfil(nick, telaAnterior='home') {
  _perfilAnterior = telaAnterior;
  const btn = document.getElementById('perfil-back-btn');
  if (btn) btn.onclick = () => showScreen(telaAnterior);
  const container = document.getElementById('perfil-content');
  container.innerHTML = '<div style="display:flex;justify-content:center;padding:3rem;"><div class="loading-spinner"></div></div>';
  showScreen('perfil');
  try {
    const d = await apiGet('perfil', { nick });
    const avatarUrl = `https://www.habbo.com.br/habbo-imaging/avatarimage?user=${encodeURIComponent(d.nick)}&action=std&direction=4&head_direction=4&img_format=png&gesture=std&headonly=1&size=l`;
    const avatarHead = `https://www.habbo.com.br/habbo-imaging/avatarimage?user=${encodeURIComponent(d.nick)}&action=std&direction=4&head_direction=4&img_format=png&gesture=std&headonly=1&size=l`;
    const nickL = d.nick.toLowerCase();
    const ehProprio = nickL === state.nick.toLowerCase();
    const embHtml = renderEmblemas(d.emblemas);
    const editarBtn = ehProprio
      ? `<button class="btn-sm" onclick="abrirEditarPerfil()" style="margin-top:.75rem;display:inline-flex;align-items:center;gap:5px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Editar perfil</button>` : '';
    const adminBtn = state.isAdmin && !ehProprio
      ? `<button class="btn-sm" onclick="abrirDarEmblema('${d.nick}')" style="margin-top:.75rem;margin-left:.5rem;display:inline-flex;align-items:center;gap:5px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/></svg>Emblemas</button>` : '';

    // Cores e estilos por tipo de perfil
    const perfilConfig = {
      deusa: {
        bg: 'linear-gradient(135deg,#0f0a00 0%,#1a1200 40%,#0f0d00 100%)',
        border: 'rgba(255,200,50,.25)',
        accent: '#ffd700',
        accentDim: 'rgba(255,200,50,.08)',
        accentBorder: 'rgba(255,200,50,.15)',
        tag: '👑 Rainha',
        tagStyle: 'background:rgba(255,200,50,.12);border:1px solid rgba(255,200,50,.3);color:#ffd700;',
        nomeStyle: 'background:linear-gradient(90deg,#ffd700,#ffb347,#ffd700);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:goldShimmer 3s linear infinite;',
        avatarBorder: '3px solid rgba(255,200,50,.5)',
        avatarShadow: '0 0 30px rgba(255,180,0,.3)',
        glow: 'animation:darkGlow 4s ease-in-out infinite;',
        scanline: false,
      },
      bryanrx: {
        bg: '#080808',
        border: 'rgba(200,0,0,.2)',
        accent: '#ff3333',
        accentDim: 'rgba(255,30,30,.06)',
        accentBorder: 'rgba(255,30,30,.12)',
        tag: '> Dev',
        tagStyle: 'background:rgba(200,0,0,.1);border:1px solid rgba(200,0,0,.25);color:#ff4444;font-family:"SF Mono",monospace;border-radius:4px;letter-spacing:.5px;',
        nomeStyle: 'color:#e0e0e0;font-family:"SF Mono",monospace;',
        avatarBorder: '2px solid rgba(200,0,0,.5)',
        avatarShadow: '0 0 0 4px rgba(200,0,0,.08),0 0 40px rgba(200,0,0,.25)',
        glow: '',
        scanline: true,
      },
      admin: {
        bg: 'linear-gradient(135deg,#0d1117 0%,#0f1923 50%,#0a1628 100%)',
        border: 'rgba(100,180,255,.18)',
        accent: '#4c9eff',
        accentDim: 'rgba(100,180,255,.06)',
        accentBorder: 'rgba(100,180,255,.12)',
        tag: '🛡 Administrador',
        tagStyle: 'background:rgba(100,180,255,.1);border:1px solid rgba(100,180,255,.2);color:#7ec8f5;',
        nomeStyle: 'color:#e8f4fd;',
        avatarBorder: '2px solid rgba(100,180,255,.4)',
        avatarShadow: '0 0 20px rgba(76,158,255,.2)',
        glow: '',
        scanline: false,
      },
      normal: {
        bg: 'var(--bg-card)',
        border: 'var(--border)',
        accent: 'var(--green)',
        accentDim: 'var(--green-dim)',
        accentBorder: 'var(--green-border)',
        tag: d.cargo || 'Membro',
        tagStyle: 'background:rgba(255,255,255,.06);border:1px solid var(--border);color:var(--c3);',
        nomeStyle: 'color:var(--c1);',
        avatarBorder: '2px solid var(--border-m)',
        avatarShadow: 'none',
        glow: '',
        scanline: false,
      }
    };

    const tipo = nickL === 'deusa' ? 'deusa' : nickL === 'bryanrx' ? 'bryanrx' : d.is_admin ? 'admin' : 'normal';
    const cfg = perfilConfig[tipo];

    const statItems = [
      { label: 'Treinos', val: d.stats.treinos, icon: '✏️' },
      { label: 'Reais', val: d.stats.reais, icon: '🎯' },
      { label: 'Taxa Acerto', val: d.stats.taxa_acerto + '%', icon: '📊' },
      { label: 'Nota Total', val: d.stats.nota_total || '—', icon: '🏅' },
    ];

    const scanlineCSS = cfg.scanline
      ? `position:relative;overflow:hidden;`
      : '';

    const scanlineEl = cfg.scanline
      ? `<div style="position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(255,0,0,.012) 2px,rgba(255,0,0,.012) 4px);pointer-events:none;z-index:0;"></div>`
      : '';

    container.innerHTML = `
  <div style="border:1px solid ${cfg.border};border-radius:20px;overflow:visible;background:${cfg.bg};${cfg.glow}${scanlineCSS}box-shadow:0 8px 40px rgba(0,0,0,.5);">
    ${scanlineEl}

    <!-- HERO BANNER -->
    <div style="position:relative;height:140px;background:linear-gradient(135deg,${cfg.accentDim} 0%,transparent 60%);border-radius:20px 20px 0 0;overflow:hidden;">
      <div style="position:absolute;inset:0;background:radial-gradient(ellipse at 15% 50%,${cfg.accentDim} 0%,transparent 65%);"></div>
      <div style="position:absolute;inset:0;background-image:linear-gradient(${cfg.accentBorder} 1px,transparent 1px),linear-gradient(90deg,${cfg.accentBorder} 1px,transparent 1px);background-size:36px 36px;opacity:.35;"></div>
      <!-- Nick + tag no banner -->
      <div style="position:absolute;bottom:20px;left:200px;right:2rem;">
        <div style="font-size:30px;font-weight:700;letter-spacing:-.6px;line-height:1;${cfg.nomeStyle}">${d.nick}</div>
        <div style="display:flex;align-items:center;gap:.5rem;margin-top:8px;flex-wrap:wrap;">
          <span style="font-size:11px;font-weight:600;padding:3px 12px;border-radius:99px;${cfg.tagStyle}">${cfg.tag}</span>
          ${d.patente ? `<span style="font-size:12px;color:var(--c4);">${d.patente}</span>` : ''}
        </div>
      </div>
    </div>

    <!-- AVATAR sobreposto -->
    <div style="position:relative;z-index:2;margin-top:-56px;padding:0 2rem;display:flex;align-items:flex-end;gap:1rem;">
      <div style="flex-shrink:0;position:relative;">
        <img src="${avatarUrl}"
          style="width:108px;height:108px;object-fit:cover;image-rendering:pixelated;border:${cfg.avatarBorder};border-radius:50%;background:var(--bg-deep);box-shadow:${cfg.avatarShadow};"
          onerror="this.src='${avatarHead}'">
        <div style="position:absolute;bottom:5px;right:5px;width:16px;height:16px;border-radius:50%;background:${cfg.accent};border:2.5px solid var(--bg-deep);box-shadow:0 0 10px ${cfg.accent};"></div>
      </div>
      <div style="padding-bottom:.625rem;display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;">
        ${editarBtn}${adminBtn}
      </div>
    </div>

    <!-- BODY PRINCIPAL -->
    <div style="padding:1.5rem 2rem 2rem;display:grid;grid-template-columns:1.2fr 1fr;gap:2rem;position:relative;z-index:1;overflow:visible;">

      <!-- COLUNA ESQUERDA: stats + ID -->
      <div>
        <div style="font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${cfg.accent};margin-bottom:1rem;display:flex;align-items:center;gap:8px;">
          <div style="width:20px;height:1px;background:${cfg.accent};"></div>
          Estatísticas
          <div style="flex:1;height:1px;background:${cfg.accentBorder};"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;">
          ${statItems.map(s => `
            <div style="background:${cfg.accentDim};border:1px solid ${cfg.accentBorder};border-radius:14px;padding:1.1rem 1.25rem;position:relative;overflow:hidden;transition:border-color .2s;"
              onmouseover="this.style.borderColor='${cfg.accent}'" onmouseout="this.style.borderColor='${cfg.accentBorder}'">
              <div style="position:absolute;top:.875rem;right:.875rem;font-size:18px;opacity:.2;">${s.icon}</div>
              <div style="font-size:28px;font-weight:700;color:${cfg.accent};letter-spacing:-.4px;font-variant-numeric:tabular-nums;line-height:1;">${s.val}</div>
              <div style="font-size:10px;color:var(--c4);margin-top:5px;text-transform:uppercase;letter-spacing:.5px;font-weight:600;">${s.label}</div>
            </div>`).join('')}
        </div>

        <!-- ID card -->
        <div style="margin-top:1rem;padding:.875rem 1.25rem;background:${cfg.accentDim};border:1px solid ${cfg.accentBorder};border-radius:12px;display:flex;align-items:center;justify-content:space-between;">
          <div style="font-size:10px;color:var(--c4);font-weight:600;letter-spacing:.5px;text-transform:uppercase;">ID do membro</div>
          <div style="font-size:12px;color:${cfg.accent};font-family:'SF Mono',monospace;letter-spacing:1px;">${d.nick.toUpperCase().replace(/[^A-Z0-9]/g,'·').slice(0,10)}</div>
        </div>
      </div>

      <!-- COLUNA DIREITA: emblemas -->
      <div>
        <div style="font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${cfg.accent};margin-bottom:1rem;display:flex;align-items:center;gap:8px;">
          <div style="width:20px;height:1px;background:${cfg.accent};"></div>
          Emblemas
          <div style="flex:1;height:1px;background:${cfg.accentBorder};"></div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:.75rem;min-height:120px;padding:1.25rem;background:${cfg.accentDim};border:1px solid ${cfg.accentBorder};border-radius:14px;align-content:flex-start;overflow:visible;">
          ${d.emblemas && d.emblemas.length ? d.emblemas.map(id => {
            const e = EMBLEMAS_DEF[id];
            if (!e) return '';
            const desc = EMBLEMAS_DESC[id] || '';
            return `<div class="emblema-item" style="border-color:${cfg.accentBorder};width:52px;height:52px;">
              <img src="${e.url}" alt="${e.nome}" style="width:40px;height:40px;">
              <div class="emblema-tooltip">
                <div class="emblema-tooltip-nome">${e.nome}</div>
                <div class="emblema-tooltip-desc">${desc}</div>
              </div>
            </div>`;
          }).join('') : `<div style="font-size:12px;color:var(--c4);display:flex;align-items:center;justify-content:center;width:100%;min-height:80px;">Nenhum emblema ainda.</div>`}
        </div>

        <!-- Contagem de emblemas -->
        <div style="margin-top:.625rem;text-align:right;font-size:11px;color:var(--c4);">
          ${d.emblemas ? d.emblemas.length : 0} emblema${(d.emblemas?.length||0) !== 1 ? 's' : ''} desbloqueado${(d.emblemas?.length||0) !== 1 ? 's' : ''}
        </div>
      </div>

    </div>
  </div>`;

  } catch(e) {
    container.innerHTML = '<div style="text-align:center;padding:3rem;color:var(--c4);">Erro ao carregar perfil.</div>';
  }
}

function verPerfilProprio() { abrirPerfil(state.nick, 'home'); }

function abrirEditarPerfil() {
  showModal(`
    <h3>Editar meu perfil</h3>
    <div class="modal-field">
      <div class="modal-label">Patente / Cargo</div>
      <input type="text" class="modal-input" id="edit-patente" placeholder="Ex: Aspirante, Soldado..." maxlength="60">
    </div>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeModal()">Cancelar</button>
      <button class="btn-save" onclick="salvarMeuPerfil()">Salvar</button>
    </div>
  `);
}

async function salvarMeuPerfil() {
  const patente = document.getElementById('edit-patente')?.value?.trim() || '';
  try {
    await apiPost('salvar_perfil', { nick: state.nick, patente });
    showToast('Perfil atualizado!', 'success');
    closeModal();
    abrirPerfil(state.nick, _perfilAnterior);
  } catch(e) { showToast('Erro ao salvar.', 'error'); }
}

function abrirDarEmblema(nick) {
  const html = EMBLEMAS_MANUAIS.map(id => {
    const e = EMBLEMAS_DEF[id];
    return `<div style="display:flex;align-items:center;gap:.75rem;padding:.75rem;background:var(--bg-deep);border:1px solid var(--border);border-radius:10px;">
      <img src="${e.url}" style="width:32px;height:32px;image-rendering:pixelated;">
      <div style="flex:1;font-size:13px;color:var(--c1);">${e.nome}</div>
      <button class="btn-sm dark" onclick="darEmblemaAo('${nick}','${id}')">Dar</button>
      <button class="btn-sm" style="color:#ff453a;" onclick="removerEmblemaAo('${nick}','${id}')">Remover</button>
    </div>`;
  }).join('');
  showModal(`<h3>Emblemas de ${nick}</h3>${html}<div class="modal-actions"><button class="btn-cancel" onclick="closeModal()">Fechar</button></div>`);
}

    async function darEmblemaAo(nick, emblema_id) {
    try { await apiPost('dar_emblema', { nick, emblema_id, admin_nick: state.nick }); showToast('Emblema concedido!', 'success'); }
    catch(e) { showToast('Erro.', 'error'); }
    }

async function removerEmblemaAo(nick, emblema_id) {
  try { await apiPost('remover_emblema', { nick, emblema_id }); showToast('Emblema removido.', 'success'); }
  catch(e) { showToast('Erro.', 'error'); }
}

function buscarPerfil() {
  const nick = document.getElementById('perfil-busca')?.value?.trim();
  if (!nick) { showToast('Digite um nick.', 'error'); return; }
  document.getElementById('perfil-busca').value = '';
  abrirPerfil(nick, 'perfil');
}

// ================================================================
// RANKING
// ================================================================
let _rankingData = null;
let _rankingTab = 'real';

async function loadRanking() {
  const container = document.getElementById('ranking-content');
  container.innerHTML = '<div style="display:flex;justify-content:center;padding:3rem;"><div class="loading-spinner"></div></div>';
  try {
    const data = await apiGet('ranking');
    _rankingData = data;
    renderRanking();
  } catch(e) {
    container.innerHTML = '<div style="text-align:center;padding:3rem;color:var(--c4);">Erro ao carregar.</div>';
  }
}

function switchRankingTab(tab) {
  _rankingTab = tab;
  document.querySelectorAll('.ranking-tab').forEach((t, i) => {
    t.className = 'ranking-tab' + (['real','treino'][i] === tab ? ' active' : '');
  });
  renderRanking();
}

function renderRanking() {
  if (!_rankingData) return;
  const container = document.getElementById('ranking-content');
  const lista = _rankingTab === 'real' ? _rankingData.ranking_real : _rankingData.ranking_treino;
  if (!lista || !lista.length) {
    container.innerHTML = '<div style="text-align:center;padding:3rem;color:var(--c4);">Nenhum resultado ainda.</div>';
    return;
  }
  const medal = i => i===0?'🥇':i===1?'🥈':i===2?'🥉':String(i+1);
  const numClass = i => i===0?'r1':i===1?'r2':i===2?'r3':'';
  const rankClass = i => i===0?'rank-1':i===1?'rank-2':i===2?'rank-3':'';
  container.innerHTML = `<div style="display:flex;flex-direction:column;gap:.625rem;">${lista.map((m,i) => `
    <div class="ranking-item ${rankClass(i)}" style="animation-delay:${i*.05}s" onclick="abrirPerfil('${m.nick}','ranking')">
      <div class="rank-num ${numClass(i)}">${medal(i)}</div>
      <img class="rank-avatar" src="https://www.habbo.com.br/habbo-imaging/avatarimage?user=${encodeURIComponent(m.nick)}&headonly=1&size=s&direction=4&head_direction=4" onerror="this.style.display='none'">
      <div style="flex:1;min-width:0;">
        <div class="rank-nick">${m.nick}</div>
        <div class="rank-sub">${_rankingTab==='real'?m.edicoes_reais+' simulados reais':m.treinos_count+' treinos realizados'}</div>
      </div>
      <div style="text-align:right;">
        <div class="rank-val">${_rankingTab==='real'?m.edicoes_reais:m.taxa_acerto+'%'}</div>
        <div class="rank-val-sub">${_rankingTab==='real'?'simulados':'acerto'}</div>
      </div>
    </div>`).join('')}</div>`;
}

function initEmblemasAdmin() {
  const lista = document.getElementById('emblemas-lista-admin');
  if (!lista) return;
  lista.innerHTML = EMBLEMAS_MANUAIS.map(id => {
    const e = EMBLEMAS_DEF[id];
    return `<div style="display:flex;align-items:center;gap:.75rem;padding:.75rem;background:var(--bg-deep);border:1px solid var(--border);border-radius:10px;">
      <img src="${e.url}" style="width:28px;height:28px;image-rendering:pixelated;">
      <div style="flex:1;font-size:13px;color:var(--c2);">${e.nome}</div>
      <button class="btn-sm dark" onclick="darEmblemaInput('${id}')">Dar</button>
      <button class="btn-sm" style="color:#ff453a;" onclick="removerEmblemaInput('${id}')">Remover</button>
    </div>`;
  }).join('');
}

function darEmblemaInput(id) {
  const nick = document.getElementById('emblema-nick')?.value?.trim();
  if (!nick) { showToast('Digite o nick.', 'error'); return; }
  darEmblemaAo(nick, id);
}

function removerEmblemaInput(id) {
  const nick = document.getElementById('emblema-nick')?.value?.trim();
  if (!nick) { showToast('Digite o nick.', 'error'); return; }
  removerEmblemaAo(nick, id);
}

let _emblemaDebounce = null;
function carregarEmblemaMembro() {
  clearTimeout(_emblemaDebounce);
  _emblemaDebounce = setTimeout(async () => {
    const nick = document.getElementById('emblema-nick')?.value?.trim();
    const mini = document.getElementById('emblema-perfil-mini');
    if (!nick || nick.length < 2) { if (mini) mini.innerHTML = ''; return; }
    try {
      const d = await apiGet('perfil', { nick });
      if (mini) mini.innerHTML = `<div style="display:flex;align-items:center;gap:.75rem;padding:.75rem;background:var(--bg-deep);border:1px solid var(--border);border-radius:10px;margin-top:.5rem;">
        <img src="https://www.habbo.com.br/habbo-imaging/avatarimage?user=${encodeURIComponent(d.nick)}&headonly=1&size=s&direction=4&head_direction=4" style="width:28px;height:28px;border-radius:50%;image-rendering:pixelated;">
        <div><div style="font-size:13px;font-weight:600;color:var(--c1);">${d.nick}</div><div style="font-size:11px;color:var(--c4);">${d.cargo||'Membro'}</div></div>
      </div>`;
    } catch(e) { if (mini) mini.innerHTML = ''; }
  }, 500);
}

// ================================================================
// HALL DO CQ
// ================================================================
const MEDAL_URL = 'https://images.habbo.com/c_images/album1584/DE91J.png';
const AVATAR_URL      = nick => `https://www.habbo.com.br/habbo-imaging/avatarimage?user=${encodeURIComponent(nick)}&action=std&direction=4&head_direction=4&img_format=png&gesture=std&headonly=1&size=l`;
const AVATAR_FULL_URL = nick => `https://www.habbo.com.br/habbo-imaging/avatarimage?user=${encodeURIComponent(nick)}&action=std&direction=4&head_direction=4&img_format=png&gesture=std&headonly=0&size=l`;

// Banco de aprovados — edite este array para adicionar mais
let cqAprovados = [
  { nick: "!=Top.Gear=!",     edicao: "2025.1"  },
  { nick: "Sliker244",        edicao: "2025.1"  },
  { nick: "Gustavo10364",     edicao: "2025.2"  },
  { nick: "chid",             edicao: "2025.2"  },
  { nick: "NeguinDaPesada",   edicao: "2025.3"  },
  { nick: "Lucasbif.Ban",     edicao: "2025.3"  },
  { nick: "Mwdeiros",         edicao: "2025.4"  },
  { nick: "isabellaju97",     edicao: "2025.4"  },
  { nick: "Almeida_hay",      edicao: "2025.9"  },
  { nick: ".-.JamesBond.-.",  edicao: "2025.9"  },
  { nick: "hauky1",           edicao: "2025.9"  },
  { nick: "Magrila:.-",       edicao: "2025.9"  },
  { nick: "florz2000.",       edicao: "2025.11" },
  { nick: "Kesie",            edicao: "2025.12" },
  { nick: ".Hyves.",          edicao: "2025.12" },
  { nick: "Deusa",            edicao: "2025.15" },
  { nick: "FritzzJ",          edicao: "2025.15" },
  { nick: "pedropaul200",     edicao: "2025.16" },
  { nick: "Nawnnn12",         edicao: "2025.16" },
  { nick: "gabriel-fluBAN",   edicao: "2025.20" },
  { nick: "Looysx",           edicao: "2025.20" }
];

let hallFiltroAtivo = 'todos';

function ordenarPorEdicao(arr) {
  return [...arr].sort((a, b) => {
    const [ya, ma] = a.edicao.split('.').map(Number);
    const [yb, mb] = b.edicao.split('.').map(Number);
    if(ya !== yb) return ya - yb;
    return ma - mb;
  });
}

async function renderHall() {
    // Carregar do Sheets se disponível
    try {
      const data = await apiGet('listar_cq');
      if (data.aprovados && Array.isArray(data.aprovados)) {
        cqAprovados = data.aprovados;
      }
    } catch(e) {
      // usa array local como fallback
    }
    // Mostrar botão admin se for admin
  const btnAdd = document.getElementById('btn-add-cq');
  if(btnAdd) btnAdd.classList.toggle('hidden', !state.isAdmin);
  const btnExp = document.getElementById('btn-export-cq');
  if(btnExp) btnExp.classList.toggle('hidden', !state.isAdmin);
  const btnImp = document.getElementById('btn-import-cq');
  if(btnImp) btnImp.classList.toggle('hidden', !state.isAdmin);

  // Montar lista de edições únicas
  const edicoes = ['todos', ...new Set(cqAprovados.map(a => a.edicao).sort((a,b) => {
    const [ya, ma] = a.split('.').map(Number);
    const [yb, mb] = b.split('.').map(Number);
    return ya !== yb ? ya - yb : ma - mb;
  }))];

  // Filtros
  const filterEl = document.getElementById('hall-filter');
  if(filterEl) {
    filterEl.innerHTML = edicoes.map(e => `
      <button class="hall-filter-btn${hallFiltroAtivo===e?' active':''}"
        onclick="filtrarHall('${e}')">
        ${e === 'todos' ? 'Todas as edições' : 'Edição ' + e}
      </button>
    `).join('');
  }

  // Filtrar lista
  const lista = ordenarPorEdicao(
    hallFiltroAtivo === 'todos'
      ? cqAprovados
      : cqAprovados.filter(a => a.edicao === hallFiltroAtivo)
  );

  // Count
  const countEl = document.getElementById('hall-count');
  if(countEl) countEl.innerHTML = `<span>${lista.length}</span> certificado${lista.length !== 1 ? 's' : ''} encontrado${lista.length !== 1 ? 's' : ''}`;

  // Cards
  const grid = document.getElementById('hall-grid');
  if(!grid) return;
  // Índice real no array original (não no filtrado)
  grid.innerHTML = lista.map((a, i) => {
    const idxReal = cqAprovados.indexOf(a);
    return `
    <div class="hall-card" style="animation-delay:${i * 0.04}s;cursor:pointer;" onclick="abrirPerfil('${a.nick}','hall')">
      <img class="hall-avatar"
        src="${AVATAR_URL(a.nick)}"
        alt="${a.nick}"
        onerror="this.src='data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=='">
      <div class="hall-info">
        <div class="hall-nick">${a.nick}</div>
        <div class="hall-edicao">Edição ${a.edicao}</div>
      </div>
      <img class="hall-medal" src="${MEDAL_URL}" alt="CQ" title="Certificado CQ">
      ${state.isAdmin ? `<button class="btn-sm" style="flex-shrink:0;margin-left:.25rem;" onclick="event.stopPropagation();editarCQ(${idxReal})">✎</button>` : ''}
    </div>
  `}).join('');
}

function filtrarHall(edicao) {
  hallFiltroAtivo = edicao;
  renderHall();
}

function abrirAddCQ() {
  if(!state.isAdmin) return;
  showModal(`
    <h3>Adicionar Aprovado</h3>
    <div class="modal-field">
      <div class="modal-label">Nick (Habbo)</div>
      <input type="text" class="modal-input" id="cq-nick" placeholder="NickExato">
    </div>
    <div class="modal-field">
      <div class="modal-label">Edição</div>
      <input type="text" class="modal-input" id="cq-edicao" placeholder="Ex: 2025.21">
    </div>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeModal()">Cancelar</button>
      <button class="btn-save" onclick="salvarCQ()">Adicionar</button>
    </div>
  `);
}

function salvarCQ() {
  const nick = document.getElementById('cq-nick')?.value?.trim();
  const edicao = document.getElementById('cq-edicao')?.value?.trim();
  if(!nick || !edicao) { showToast('Preencha todos os campos.', 'error'); return; }
  cqAprovados.push({ nick, edicao });
  closeModal();
  renderHall();
  showToast(`${nick} adicionado ao Hall do CQ!`, 'success');
  apiPost('salvar_cq', { nick, edicao, admin_nick: state.nick }).then(() => renderHall()).catch(()=>{});
}

function verPerfilCQ(idx) {
  const a = cqAprovados[idx];
  if(!a) return;
  showModal(`
    <div style="text-align:center;padding:.5rem 0 1rem;">
      <img
        src="${AVATAR_FULL_URL(a.nick)}"
        alt="${a.nick}"
        style="height:160px;image-rendering:pixelated;margin-bottom:1rem;"
        onerror="this.style.display='none'">
      <div style="font-size:22px;font-weight:700;color:var(--c1);letter-spacing:-.4px;margin-bottom:4px;">${a.nick}</div>
      <div style="font-size:13px;color:var(--c4);margin-bottom:1.25rem;">Edição ${a.edicao}</div>
      <div style="display:flex;align-items:center;justify-content:center;gap:10px;background:var(--green-dim);border:1px solid var(--green-border);border-radius:10px;padding:12px 20px;width:fit-content;margin:0 auto;">
        <img src="${MEDAL_URL}" style="width:28px;height:28px;image-rendering:pixelated;" alt="CQ">
        <div style="text-align:left;">
          <div style="font-size:12px;color:var(--green);font-weight:600;letter-spacing:.3px;text-transform:uppercase;">Certificado CQ</div>
          <div style="font-size:11px;color:var(--c4);margin-top:1px;">Certificado de Qualificação de Oficiais Intermediários</div>
        </div>
      </div>
    </div>
    <div class="modal-actions" style="justify-content:center;margin-top:1rem;">
      <button class="btn-cancel" onclick="closeModal()">Fechar</button>
    </div>
  `);
}

function editarCQ(idx) {
  if(!state.isAdmin) return;
  const a = cqAprovados[idx];
  if(!a) return;
  showModal(`
    <h3>Editar Aprovado</h3>
    <div class="modal-field">
      <div class="modal-label">Nick (Habbo)</div>
      <input type="text" class="modal-input" id="cq-edit-nick" value="${a.nick}">
    </div>
    <div class="modal-field">
      <div class="modal-label">Edição</div>
      <input type="text" class="modal-input" id="cq-edit-edicao" value="${a.edicao}">
    </div>
    <div class="modal-actions">
      <button class="btn-cancel" style="color:#ff453a;border-color:rgba(255,69,58,.3);" onclick="removerCQ(${idx})">Remover</button>
      <button class="btn-cancel" onclick="closeModal()">Cancelar</button>
      <button class="btn-save" onclick="atualizarCQ(${idx})">Salvar</button>
    </div>
  `);
}

function atualizarCQ(idx) {
  const nick = document.getElementById('cq-edit-nick')?.value?.trim();
  const edicao = document.getElementById('cq-edit-edicao')?.value?.trim();
  if(!nick || !edicao) { showToast('Preencha todos os campos.', 'error'); return; }
  cqAprovados[idx] = { nick, edicao };
  closeModal();
  renderHall();
  showToast(`${nick} atualizado!`, 'success');
  apiPost('atualizar_cq', { idx, nick, edicao, admin_nick: state.nick }).catch(()=>{});
}

function removerCQ(idx) {
  const a = cqAprovados[idx];
  if(!confirm(`Remover ${a.nick} do Hall do CQ?`)) return;
  cqAprovados.splice(idx, 1);
  closeModal();
  renderHall();
  showToast(`${a.nick} removido.`, 'success');
  apiPost('remover_cq', { idx, admin_nick: state.nick }).catch(()=>{});
}

// ================================================================
// HALL DO CQ — IMPORT / EXPORT JSON
// ================================================================
function exportarJSON() {
  const data = { aprovados: cqAprovados };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'aprovados-ceqm.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('JSON exportado!', 'success');
}

async function importarJSON(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const data = JSON.parse(e.target.result);
      const lista = Array.isArray(data) ? data : data.aprovados;
      if (!Array.isArray(lista)) throw new Error('Formato inválido');

      const validos = lista.filter(a => a.nick && a.edicao);
      if (!validos.length) throw new Error('Nenhum aprovado válido encontrado');

      if (!confirm(`Importar ${validos.length} aprovados?\nIsso substituirá a lista atual no banco de dados.`)) return;

      // Salva cada aprovado no Sheets
      showToast('Importando... aguarde.', 'success');
      for (const a of validos) {
        await apiPost('salvar_cq', { nick: a.nick, edicao: a.edicao });
      }

      cqAprovados = validos;
      renderHall();
      showToast(`${validos.length} aprovados importados e salvos!`, 'success');
    } catch(err) {
      showToast('Erro: ' + err.message, 'error');
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsText(file);
}

// ================================================================
// ADMIN — SIMULADO REAL
// ================================================================
let srPerguntas = []; // perguntas do simulado real (admin)

function loadSimuladoRealAdmin() {
  atualizarBadgeSR();
  apiGet('todas_perguntas').then(data => {
    srPerguntas = (data.perguntas || []).filter(q => q.tipo === 'real');
    renderSRPerguntas();
  }).catch(() => renderSRPerguntas());
  loadCorrecoesReal();
}

function renderSRPerguntas() {
  const lista = document.getElementById('sr-perguntas-lista');
  const count = document.getElementById('sr-q-count');
  if (!lista) return;
  if (count) count.textContent = srPerguntas.length;

  if (!srPerguntas.length) {
    lista.innerHTML = `<div style="text-align:center;padding:1.5rem;color:var(--c4);font-size:13px;border:1px dashed var(--border);border-radius:10px;">Nenhuma pergunta criada. Clique em "+ Nova pergunta" para começar.</div>`;
    return;
  }

  const docClass = { CCM:'doc-ccm', CPM:'doc-cpm', PCE:'doc-pce', CCB:'doc-ccb' };
  lista.innerHTML = srPerguntas.map((q, i) => `
    <div style="display:flex;align-items:center;gap:.75rem;background:var(--bg-deep);border:1px solid var(--border);border-radius:10px;padding:.875rem 1rem;">
      <span style="font-size:11px;font-weight:700;color:var(--c5);min-width:24px;">Q${i+1}</span>
      <span class="q-doc-badge ${docClass[q.documento]||'doc-ccm'}" style="flex-shrink:0;">${q.documento}</span>
      <span style="font-size:13px;color:var(--c2);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${q.pergunta}</span>
      <span style="font-size:11px;color:var(--c4);flex-shrink:0;">${Math.floor((q.tempo||120)/60)}:${String((q.tempo||120)%60).padStart(2,'0')} min</span>
      <button class="btn-sm" onclick="editarPerguntaReal(${i})">✎</button>
      <button class="btn-sm" style="color:#ff453a;" onclick="removerPerguntaReal(${i})">✕</button>
    </div>
  `).join('');
}

function abrirAddPerguntaReal(q={}, idx=null) {
  const pesos = ['0,10','0,15','0,20','0,25','0,30','0,40','0,50'];
  showModal(`
    <h3>${idx !== null ? 'Editar' : 'Nova'} Pergunta — Simulado Real</h3>
    <div class="q-form-grid">
      <div class="form-group"><label>Documento</label>
        <select class="modal-input" id="srp-doc">
          ${['CCM','CPM','CCB','PCE'].map(d => `<option ${(q.documento||'CCM')===d?'selected':''}>${d}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Tempo (segundos)</label>
        <input type="number" class="modal-input" id="srp-tempo" value="${q.tempo||150}" min="60" max="600">
      </div>
    </div>
    <div class="modal-field">
      <div class="modal-label">Pergunta</div>
      <textarea class="modal-input" id="srp-pergunta" style="min-height:90px;">${q.pergunta||''}</textarea>
    </div>
    <div class="modal-field">
      <div class="modal-label">Gabarito — selecione o texto e clique no peso</div>
      <div class="gab-editor-wrap">
        <div class="gab-toolbar">
          <span class="gab-toolbar-label">Peso:</span>
          ${pesos.map(p => `<button class="gab-pont-btn" onclick="gabAplicarPeso('(${p})')">(${p})</button>`).join('')}
          <button class="gab-clear-btn" onclick="gabLimparFormato()">✕ Limpar formato</button>
        </div>
        <div class="gab-editor" id="srp-gabarito-editor"
          contenteditable="true"
          data-placeholder="Escreva o gabarito aqui. Selecione um trecho e clique no peso para destacar a pontuação daquele item..."
        >${q.gabarito ? gabHtmlParaEditor(q.gabarito) : ''}</div>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeModal()">Cancelar</button>
      <button class="btn-save" onclick="salvarPerguntaReal(${idx})">Salvar</button>
    </div>
  `);
}

// Converte texto salvo (0,10) → HTML com pont-badge para exibir no editor
function gabHtmlParaEditor(texto) {
  return texto.replace(/(\(\d+[.,]\d+\))/g,
    '<span class="pont-badge" contenteditable="false">$1</span>');
}



function editarPerguntaReal(idx) { abrirAddPerguntaReal(srPerguntas[idx], idx); }

function removerPerguntaReal(idx) {
  if (!confirm('Remover esta pergunta?')) return;
  const q = srPerguntas[idx];
  srPerguntas.splice(idx, 1);
  renderSRPerguntas();
  if (q?.id) apiPost('salvar_pergunta', { ...q, tipo: 'real', admin_nick: state.nick }).catch(()=>{});
}

function salvarPerguntaReal(idx) {
  const gabarito = gabEditorParaTextoEm('srp-gabarito-editor');
  const dados = {
    documento: document.getElementById('srp-doc').value,
    tempo:     +document.getElementById('srp-tempo').value,
    pergunta:  document.getElementById('srp-pergunta').value.trim(),
    gabarito:  gabarito,
    id:        idx !== null ? (srPerguntas[idx]?.id || null) : null
  };
  if (!dados.pergunta) { showToast('Escreva a pergunta.', 'error'); return; }
  if (idx !== null) srPerguntas[idx] = dados;
  else srPerguntas.push(dados);
  closeModal();
  renderSRPerguntas();
  apiPost('salvar_pergunta', { ...dados, tipo: 'real', admin_nick: state.nick }).catch(()=>{});
  showToast('Pergunta salva!', 'success');
}

// ── Correções do Simulado Real (com comentário) ─────────────────
async function loadCorrecoesReal() {
  const tbody = document.getElementById('sr-correcoes-body');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;"><div class="loading-spinner" style="display:inline-block;"></div></td></tr>`;
  try {
    const data = await apiGet('respostas_real');
    const lista = data.respostas || [];
    if (!lista.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--c4);padding:2rem;">Nenhuma resposta recebida ainda.</td></tr>`;
      return;
    }
    tbody.innerHTML = lista.map((r, i) => `
      <tr>
        <td style="font-weight:500;font-size:13px;white-space:nowrap;">${r.nick}</td>
        <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--c4);font-size:12px;">${r.pergunta||''}</td>
        <td><div class="resp-text" title="${r.resposta||''}">${r.resposta||'—'}</div></td>
        <td>${r.corrigido
          ? `<span class="nota-badge nota-corrigido">${r.nota}</span>`
          : `<span class="nota-badge nota-pendente">Pendente</span>`}</td>
        <td style="font-size:12px;color:var(--c4);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.comentario||'—'}</td>
        <td><button class="btn-sm" onclick="abrirCorrecaoReal(${i})">Corrigir</button></td>
      </tr>
    `).join('');
    // guardar para o modal
    window._correcoesReal = lista;
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--c4);padding:2rem;">Erro ao carregar.</td></tr>`;
  }
}

function abrirCorrecaoReal(idx) {
  const r = (window._correcoesReal || [])[idx];
  if (!r) return;

  // Gabarito com highlight de pontuação
  const gabDestacado = highlightPontuacao(r.gabarito || 'Sem gabarito cadastrado.');

  showModal(`
    <h3>Corrigir Resposta</h3>
    <div class="modal-field">
      <div class="modal-label">Membro</div>
      <div class="modal-value" style="font-weight:600;">${r.nick}</div>
    </div>
    <div class="modal-field">
      <div class="modal-label">Pergunta</div>
      <div class="modal-value" style="font-size:13px;">${r.pergunta||''}</div>
    </div>
    <div class="modal-field">
      <div class="modal-label">Resposta do candidato</div>
      <div class="modal-value" style="font-size:13px;min-height:60px;">${r.resposta||'<em style="opacity:.5;">Sem resposta</em>'}</div>
    </div>
    <div class="modal-field">
      <div class="modal-label">Gabarito</div>
      <div class="modal-value gabarito-col" style="font-size:13px;font-style:italic;background:rgba(46,204,113,.05);border-color:rgba(46,204,113,.15);">${gabDestacado}</div>
    </div>
    <div class="modal-field">
      <div class="modal-label">Nota (0 – 1,00)</div>
      <input type="number" class="modal-input" id="sr-nota" value="${r.nota||''}" min="0" max="1" step="0.05" placeholder="Ex: 0.80">
    </div>
    <div class="modal-field">
      <div class="modal-label">Comentário / Feedback</div>
      <textarea class="modal-input" id="sr-comentario" placeholder="O que faltou? O que acertou? (opcional)">${r.comentario||''}</textarea>
    </div>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeModal()">Cancelar</button>
      <button class="btn-save" onclick="salvarCorrecaoReal('${r.id||idx}')">Salvar correção</button>
    </div>
  `);
}

async function salvarCorrecaoReal(id) {
  const nota      = document.getElementById('sr-nota')?.value;
  const comentario = document.getElementById('sr-comentario')?.value || '';
  if (nota === '' || nota === null) { showToast('Insira uma nota.', 'error'); return; }
  try {
    await apiPost('corrigir', { id, nota, gabarito: comentario, nick: state.nick });
    showToast('Correção salva!', 'success');
    closeModal();
    loadCorrecoesReal();
  } catch(e) {
    showToast('Erro ao salvar. Tente novamente.', 'error');
  }
}

// ================================================================
// MINHA PROVA
// ================================================================
async function loadMinhaProva() {
  const container = document.getElementById('minha-prova-content');
  if (!container) return;
  container.innerHTML = '<div style="display:flex;justify-content:center;padding:3rem;"><div class="loading-spinner"></div></div>';

  try {
    const data = await apiGet('respostas_real', { nick: state.nick });
    const minhas = data.respostas || [];

    if (!minhas.length) {
      container.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--c4);">
        <div style="font-size:40px;margin-bottom:1rem;">📋</div>
        <div style="font-size:16px;font-weight:600;color:var(--c1);margin-bottom:.5rem;">Nenhuma prova encontrada</div>
        <div style="font-size:14px;">Você ainda não realizou o Simulado Real.</div>
      </div>`;
      return;
    }

    const porEdicao = {};
    minhas.forEach(r => {
      const ed = r.edicao || '—';
      if (!porEdicao[ed]) porEdicao[ed] = [];
      porEdicao[ed].push(r);
    });

    const docClass = { CCM:'doc-ccm', CPM:'doc-cpm', PCE:'doc-pce', CCB:'doc-ccb' };

    function getStatus(respostas) {
      const corrigidas = respostas.filter(r => r.corrigido).length;
      if (corrigidas === 0) return 'pending';
      if (corrigidas < respostas.length) return 'partial';
      const nota = respostas.reduce((a,r) => a+(parseFloat(r.nota)||0),0);
      return nota >= 7 ? 'done-ok' : 'done-fail';
    }

    function statusLabel(s) {
      return {pending:'Aguardando correção',partial:'Em correção','done-ok':'Aprovado','done-fail':'Reprovado'}[s];
    }
    function statusStyle(s) {
      return {
        pending:'background:rgba(255,159,10,.1);color:#ff9f0a;border:1px solid rgba(255,159,10,.25);',
        partial:'background:rgba(0,122,255,.1);color:#4c9eff;border:1px solid rgba(0,122,255,.2);',
        'done-ok':'background:rgba(46,204,113,.1);color:#2ecc71;border:1px solid rgba(46,204,113,.25);',
        'done-fail':'background:rgba(255,69,58,.1);color:#ff453a;border:1px solid rgba(255,69,58,.2);'
      }[s];
    }
    function iconFor(s) {
      return {pending:'⏳',partial:'◑','done-ok':'🎖️','done-fail':'📝'}[s];
    }
    function fillColor(s) {
      return {pending:'#ff9f0a',partial:'#4c9eff','done-ok':'#2ecc71','done-fail':'#ff453a'}[s];
    }
    function iconBg(s) {
      return {
        pending:'background:rgba(255,159,10,.12);',
        partial:'background:rgba(0,122,255,.1);',
        'done-ok':'background:rgba(46,204,113,.12);',
        'done-fail':'background:rgba(255,69,58,.1);'
      }[s];
    }

    const edCards = Object.entries(porEdicao).map(([edicao, respostas], idx) => {
      const status = getStatus(respostas);
      const corrigidas = respostas.filter(r => r.corrigido).length;
      const notaTotal = respostas.filter(r=>r.corrigido).reduce((a,r)=>a+(parseFloat(r.nota)||0),0);
      const pct = Math.round(corrigidas/respostas.length*100);

      const qHtml = respostas.map((r,i) => `
        <div style="background:var(--bg-deep);border:1px solid var(--border);border-radius:12px;padding:1.1rem;">
          <div style="display:flex;align-items:center;gap:.625rem;margin-bottom:.75rem;">
            <span class="q-doc-badge ${docClass[r.documento]||'doc-ccm'}">${r.documento}</span>
            <span style="font-size:11px;color:var(--c4);">Questão ${i+1}</span>
            <span style="margin-left:auto;font-size:11px;font-weight:500;padding:2px 8px;border-radius:99px;
              ${r.corrigido?'background:rgba(46,204,113,.1);color:#2ecc71;border:1px solid rgba(46,204,113,.2);':'background:rgba(255,159,10,.1);color:#ff9f0a;border:1px solid rgba(255,159,10,.2);'}">
              ${r.corrigido?(parseFloat(r.nota).toFixed(2)+' pts'):'Aguardando'}
            </span>
          </div>
          <div style="font-size:13px;color:var(--c3);line-height:1.6;margin-bottom:.75rem;">${r.pergunta||''}</div>
          <div style="font-size:11px;font-weight:600;color:var(--c4);text-transform:uppercase;letter-spacing:.4px;margin-bottom:.35rem;">Sua resposta</div>
          <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:9px 11px;font-size:13px;color:var(--c2);line-height:1.6;white-space:pre-wrap;word-break:break-word;max-height:150px;overflow-y:auto;">
            ${r.resposta||'<em style="opacity:.4;">Sem resposta</em>'}
          </div>
          ${r.corrigido && r.gabarito ? `
          <div style="margin-top:.625rem;">
            <div style="font-size:11px;font-weight:600;color:var(--c4);text-transform:uppercase;letter-spacing:.4px;margin-bottom:.35rem;">Gabarito</div>
            <div style="background:rgba(46,204,113,.05);border:1px solid rgba(46,204,113,.18);border-radius:8px;padding:9px 11px;font-size:13px;color:var(--c2);line-height:1.6;font-style:italic;">
              ${highlightPontuacao(r.gabarito)}
            </div>
          </div>` : ''}
          ${r.corrigido && r.comentario ? `
          <div style="margin-top:.5rem;background:rgba(255,159,10,.06);border:1px solid rgba(255,159,10,.18);border-radius:8px;padding:9px 11px;">
            <div style="font-size:11px;font-weight:600;color:#ff9f0a;margin-bottom:3px;">Comentário do avaliador</div>
            <div style="font-size:13px;color:var(--c2);line-height:1.6;">${r.comentario}</div>
          </div>` : ''}
        </div>
      `).join('');

      return `
        <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;overflow:hidden;transition:border-color .18s;" id="mpcard-${idx}">
          <div style="display:flex;align-items:center;gap:1rem;padding:1.1rem 1.25rem;cursor:pointer;" onclick="mpToggle(${idx})">
            <div style="width:42px;height:42px;border-radius:12px;${iconBg(status)}display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">${iconFor(status)}</div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:14px;font-weight:600;color:var(--c1);">Edição ${edicao}</div>
              <div style="font-size:12px;color:var(--c4);margin-top:2px;">${corrigidas} de ${respostas.length} questões corrigidas</div>
            </div>
            <div style="display:flex;align-items:center;gap:.875rem;flex-shrink:0;">
              ${corrigidas === respostas.length ? `<div style="font-size:20px;font-weight:600;color:var(--c1);font-variant-numeric:tabular-nums;">${notaTotal.toFixed(2)}<span style="font-size:11px;color:var(--c4);margin-left:2px;">pts</span></div>` : '<div style="font-size:20px;color:var(--c4);">—</div>'}
              <span style="font-size:11px;font-weight:500;padding:3px 10px;border-radius:99px;${statusStyle(status)}">${statusLabel(status)}</span>
              <div id="mpchev-${idx}" style="color:var(--c4);transition:transform .22s cubic-bezier(.4,0,.2,1);">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
              </div>
            </div>
          </div>
          <div style="height:2px;background:rgba(255,255,255,.06);">
            <div id="mpbar-${idx}" style="height:100%;width:0%;border-radius:99px;background:${fillColor(status)};transition:width .6s cubic-bezier(.4,0,.2,1);"></div>
          </div>
          <div id="mpbody-${idx}" style="max-height:0;overflow:hidden;transition:max-height .5s cubic-bezier(.4,0,.2,1);">
            <div style="padding:1.1rem;border-top:1px solid var(--border);">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;padding-bottom:.875rem;border-bottom:1px solid var(--border);">
                <div style="font-size:12px;color:var(--c4);">Nota total da edição</div>
                <div style="font-size:22px;font-weight:700;letter-spacing:-.4px;color:${corrigidas===respostas.length?(notaTotal>=7?'var(--green)':'#ff453a'):'var(--c4)'};">
                  ${corrigidas===respostas.length?notaTotal.toFixed(2)+' / '+respostas.length+'.00':'Em correção'}
                </div>
              </div>
              <div style="display:flex;flex-direction:column;gap:.625rem;">${qHtml}</div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = `<div style="display:flex;flex-direction:column;gap:.75rem;">${edCards}</div>`;

    // Animar barras de progresso
    Object.entries(porEdicao).forEach(([edicao, respostas], idx) => {
      const corrigidas = respostas.filter(r => r.corrigido).length;
      const pct = Math.round(corrigidas/respostas.length*100);
      setTimeout(() => {
        const bar = document.getElementById('mpbar-'+idx);
        if(bar) bar.style.width = pct+'%';
      }, 80 + idx*60);
    });

    // Expande automaticamente o primeiro card
    setTimeout(() => mpToggle(0), 200);

  } catch(e) {
    container.innerHTML = '<div style="text-align:center;padding:3rem;color:var(--c4);">Erro ao carregar. Tente novamente.</div>';
  }
}

function mpToggle(idx) {
  const body = document.getElementById('mpbody-'+idx);
  const chev = document.getElementById('mpchev-'+idx);
  const card = document.getElementById('mpcard-'+idx);
  if (!body) return;
  const isOpen = body.style.maxHeight !== '0px' && body.style.maxHeight !== '';
  body.style.maxHeight = isOpen ? '0px' : '9999px';
  if(chev) chev.style.transform = isOpen ? '' : 'rotate(180deg)';
  if(card) card.style.borderColor = isOpen ? '' : 'var(--border-m)';
}

window.mpToggle = function(idx) {
  const body = document.getElementById('mpbody-'+idx);
  const chev = document.getElementById('mpchev-'+idx);
  const card = document.getElementById('mpcard-'+idx);
  if (!body) return;
  const isOpen = body.style.maxHeight !== '0px' && body.style.maxHeight !== '';
  body.style.maxHeight = isOpen ? '0px' : '9999px';
  if(chev) chev.style.transform = isOpen ? '' : 'rotate(180deg)';
  if(card) card.style.borderColor = isOpen ? '' : 'var(--border-m)';
};

// Drawer open/close
function abrirDrawer() {
  document.getElementById('mob-drawer').classList.add('open');
  document.getElementById('mob-drawer-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function fecharDrawer() {
  document.getElementById('mob-drawer').classList.remove('open');
  document.getElementById('mob-drawer-overlay').classList.remove('open');
  document.body.style.overflow = '';
}
// Fechar com swipe direita (touch)
(function(){
  let startX = 0;
  const drawer = document.getElementById('mob-drawer');
  drawer.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
  drawer.addEventListener('touchend', e => {
    if (e.changedTouches[0].clientX - startX > 60) fecharDrawer();
  }, { passive: true });
})();
 
// Destacar item ativo no drawer
function setDrawerActive(screen) {
  document.querySelectorAll('.mob-nav-item').forEach(b => b.classList.remove('active'));
  const map = {
    'home': 'drawerBtn-home',
    'simulado': 'drawerBtn-treino',
    'result': 'drawerBtn-treino',
    'minha-prova': 'drawerBtn-minha-prova',
    'hall': 'drawerBtn-hall',
    'admin': 'drawerBtn-admin',
    'ranking': 'drawerBtn-ranking',
    'perfil':  'drawerBtn-ranking',
  };
  const id = map[screen];
  if (id) document.getElementById(id)?.classList.add('active');
}

async function loadPassesAdmin() {
  const tbody = document.getElementById('passes-body');
  tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:2rem;"><div class="loading-spinner" style="display:inline-block;"></div></td></tr>';
  try {
    const data = await apiGet('listar_passes');
    const lista = data.passes || [];
    if (!lista.length) { tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--c4);padding:2rem;">Nenhum passe registrado.</td></tr>'; return; }
    tbody.innerHTML = lista.map(p => `
      <tr>
        <td style="font-weight:500;font-size:13px;display:flex;align-items:center;gap:8px;">
          <img src="https://www.habbo.com.br/habbo-imaging/avatarimage?user=${encodeURIComponent(p.nick)}&headonly=1&size=s&direction=4&head_direction=4"
            style="width:22px;height:22px;image-rendering:pixelated;border-radius:50%;border:1px solid var(--border);" onerror="this.style.display='none'">
          ${p.nick}
        </td>
        <td style="color:var(--c4);font-size:12px;">${p.timestamp ? new Date(p.timestamp).toLocaleString('pt-BR') : '—'}</td>
        <td><button class="btn-sm" style="color:#ff453a;border-color:rgba(255,69,58,.3);" onclick="resetarPasseIndividual('${p.nick}')">Resetar</button></td>
      </tr>`).join('');
  } catch(e) { tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--c4);padding:2rem;">Erro ao carregar.</td></tr>'; }
}

async function resetarTodosPassesAdmin() {
  if (!confirm('Resetar TODOS os passes? Todos poderão refazer o simulado.')) return;
  try { await apiPost('resetar_passes', { admin_nick: state.nick }); showToast('Passes resetados!'); loadPassesAdmin(); }
  catch(e) { showToast('Erro ao resetar.', 'error'); }
}

async function resetarPasseIndividual(nick) {
  if (!confirm(`Resetar o passe de ${nick}?`)) return;
  try { await apiPost('resetar_passe_nick', { nick, admin_nick: state.nick }); showToast(`Passe de ${nick} resetado!`); loadPassesAdmin(); }
  catch(e) { showToast('Erro ao resetar.', 'error'); }
}
