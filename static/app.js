'use strict';
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const storedReader = (() => {try {return JSON.parse(localStorage.getItem('vector-reading')||'{}');} catch {return {};}})();
const state = {user:null, csrf:'', categories:[], editor:null, dirty:false, route:0, publishAttempted:false,
  reader:{size:['small','normal','large'].includes(storedReader.size)?storedReader.size:'normal',
    width:['narrow','normal','wide'].includes(storedReader.width)?storedReader.width:'normal'}, preview:null};
const labels = {draft:'Черновик',published:'Опубликован',archived:'В архиве'};
const date = value => value ? new Date(value.replace(' ', 'T') + (value.includes('Z') ? '' : 'Z')).toLocaleString('ru-RU', {day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
const duration = minutes => minutes >= 60 ? `${Math.floor(minutes/60)} ч ${minutes%60 ? minutes%60+' мин' : ''}` : `${minutes} мин`;
const field = (label, name, value='', type='text', extra='') => `<div class="field"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" value="${esc(value)}" ${extra}></div>`;
const area = (label, name, value='', extra='') => `<div class="field"><label for="${name}">${label}</label><textarea id="${name}" name="${name}" ${extra}>${esc(value)}</textarea></div>`;
const empty = (title, body) => `<div class="empty"><strong>${title}</strong>${body}</div>`;
const badge = status => `<span class="badge ${status==='published'?'green':status==='archived'?'gray':''}">${labels[status]||esc(status)}</span>`;
const avatar = (u, extra='') => u.avatar ? `<img class="avatar ${extra}" src="${esc(u.avatar)}" alt="Аватар">` : `<span class="avatar ${extra}">${esc(u.name[0])}</span>`;
function toast(message) { const el=$('#toast'); el.textContent=message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('show'),4500); }
async function api(path, method='GET', body=null) {
  const opts={method,headers:{'X-CSRF-Token':state.csrf},credentials:'same-origin'};
  if (body instanceof FormData) opts.body=body;
  else if (body!==null) {opts.body=JSON.stringify(body);opts.headers['Content-Type']='application/json';}
  const res=await fetch('/api'+path,opts); const d=await res.json();
  if(!res.ok) { const error=new Error(d.error||'Не удалось выполнить запрос.');error.status=res.status;throw error; }
  if(d.csrf) state.csrf=d.csrf;
  return d;
}
async function confirmAction(message) {
  const dialog=$('#confirm');$('#confirm-text').textContent=message;dialog.returnValue='cancel';dialog.showModal();
  return new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue==='ok'),{once:true}));
}
function header() {
  const p=location.pathname;
  $('#header').innerHTML=`<a href="/" class="brand"><b>↗</b> вектор<span>пространство для роста</span></a><nav aria-label="Основная навигация"><a href="/courses" class="${p==='/'||p.startsWith('/courses')?'active':''}">Каталог курсов</a>${state.user?`<a href="/dashboard" class="${p==='/dashboard'?'active':''}">Моё обучение</a><a href="/courses?status=favorite" class="${location.search.includes('favorite')?'active':''}">Избранное</a>`:''}${state.user?.role==='admin'?`<a href="/admin" class="${p.startsWith('/admin')?'active':''}">Управление</a>`:''}</nav><div class="header-user">${state.user?`<a href="/profile" class="actions">${avatar(state.user)}<span class="user-name">${esc(state.user.name.split(' ')[0])}</span></a><button class="ghost small" data-action="logout">Выйти</button>`:'<a href="/auth" class="subtle-link">Войти</a><a href="/register" class="button small">Начать учиться ↗</a>'}</div>`;
}
async function navigate(url, replace=false) {
  if(state.dirty && !(await confirmAction('Изменения курса не сохранены. Покинуть редактор?')))return;
  state.dirty=false;document.body.classList.remove('student-preview');history[replace?'replaceState':'pushState']({},'',url);await render();window.scrollTo(0,0);
}
document.addEventListener('click',async event=>{
  const link=event.target.closest('a');
  if(link && link.origin===location.origin && !link.hasAttribute('download') && !link.pathname.startsWith('/api/') && !link.target && !event.ctrlKey && !event.metaKey && !event.shiftKey && !link.hash){event.preventDefault();await navigate(link.pathname+link.search);}
});
window.addEventListener('popstate',()=>{if(state.dirty && !window.confirm('Покинуть редактор без сохранения?')){history.forward();return;}state.dirty=false;document.body.classList.remove('student-preview');render();});
window.addEventListener('beforeunload',event=>{if(state.dirty){event.preventDefault();event.returnValue='';}});
function card(c, enrolled=false) {
  const theme=courseTheme(c.category);
  return `<article class="card" data-theme="${theme}"><div class="cover" data-theme="${theme}"><a href="/courses/${c.id}" aria-label="${esc(c.title)}">${c.cover?`<img src="${esc(c.cover)}" alt="" loading="lazy">`:`<div class="cover-fallback"><span aria-hidden="true">${theme==='code'?'&lt;/&gt;':theme==='analytics'?'▥':theme==='design'?'✳':theme==='management'?'↗':theme==='security'?'◇':'↗'}</span></div>`}</a><span class="badge">${esc(c.level)}</span><button class="favorite ${c.favorite?'on':''}" data-action="favorite" data-id="${c.id}" data-enabled="${!c.favorite}" aria-label="${c.favorite?'Убрать из избранного':'В избранное'}" aria-pressed="${!!c.favorite}">${c.favorite?'♥':'♡'}</button></div><div class="card-body"><span class="card-category">${esc(c.category||'Образование')}</span><h3><a href="/courses/${c.id}">${esc(c.title)}</a></h3><p>${esc(c.summary)}</p><div class="meta"><span>▤ ${c.lesson_count} уроков</span><span>◷ ${duration(c.minutes)}</span><span>★ ${c.rating||'Новый'}</span></div>${enrolled?`<div class="card-progress"><progress value="${c.progress}" max="100" aria-label="Прогресс по курсу"></progress><small>${c.done} из ${c.lesson_count} уроков <b>${c.progress}%</b></small></div>`:''}<div class="card-bottom"><span>${c.enrollment?.completed_at?'✓ Курс завершён':c.enrollment?'Вы записаны':`${c.enrolled_count} участников`}</span><a href="${enrolled&&c.resume?'/learn/'+c.resume:'/courses/'+c.id}">${enrolled?'Продолжить':'Подробнее'} ↗</a></div></div></article>`;
}
function courseTheme(category='') {
  const value=String(category).toLocaleLowerCase('ru');
  if(/безопас|security|тестирован/.test(value))return 'security';
  if(/аналит|данн|data/.test(value))return 'analytics';
  if(/дизайн|design/.test(value))return 'design';
  if(/менедж|проект|управлен/.test(value))return 'management';
  if(/программ|разработ|веб|код/.test(value))return 'code';
  return 'general';
}
async function catalog() {
  const params = new URLSearchParams(location.search);
  if(params.get('clear_filters')==='1'){
    params.delete('clear_filters');
    history.replaceState({},'',location.pathname);
  }
  // Catalog preferences are URL state only: a fresh visit to /courses always starts clean.
  if(!location.search)try{localStorage.removeItem('vector-catalog-filters');}catch{}
  const result = await api('/courses?' + params);
  const featured = result.items.find(course => !/^(?:новый курс|1+)$/i.test(course.title.trim())) || result.items[0];
  const featuredCard = featured ? `
    <article class="featured-course" data-theme="${courseTheme(featured.category)}">
      <a class="featured-cover" data-theme="${courseTheme(featured.category)}" href="/courses/${featured.id}" aria-label="Открыть курс ${esc(featured.title)}">
        ${featured.cover ? `<img src="${esc(featured.cover)}" alt="" fetchpriority="high">` : '<span class="cover-fallback">↗</span>'}
        <span class="featured-level">${esc(featured.level)}</span>
      </a>
      <div class="featured-body">
        <div class="featured-label"><span></span> КУРС ИЗ КАТАЛОГА</div>
        <h2><a href="/courses/${featured.id}">${esc(featured.title)}</a></h2>
        <p>${esc(featured.summary)}</p>
        <div class="featured-footer"><span>▤ ${featured.lesson_count} уроков · ◷ ${duration(featured.minutes)}</span><a href="/courses/${featured.id}">Обзор курса <b>↗</b></a></div>
      </div>
    </article>` : `<div class="featured-empty">${empty('Курс появится здесь','Измените фильтры, чтобы увидеть доступные программы.')}</div>`;

  return `<section class="hero">
    <div class="hero-copy">
      <div class="hero-kicker"><span>ВЕКТОР</span> · ПРАКТИЧЕСКАЯ АКАДЕМИЯ</div>
      <h1>Теория — чтобы понимать.<br><span>Практика — чтобы уметь.</span></h1>
      <p>Выбирай навык, разбирай реальные задачи и собирай результат по шагам. Прогресс и заметки останутся с тобой.</p>
      <a href="#catalog" class="hero-link" data-action="scroll-catalog">Подобрать курс <span>↓</span></a>
      <div class="hero-notes"><span><b>01</b> Понятная программа</span><span><b>02</b> Практика внутри</span><span><b>03</b> Видимый прогресс</span></div>
    </div>
    <div class="hero-feature-wrap"><div class="hero-feature-index"><span>РЕКОМЕНДУЕМЫЙ</span><b>КУРС / 01</b></div>${featuredCard}</div>
  </section>
  <div class="catalog-heading" id="catalog"><div><div class="eyebrow">КАТАЛОГ · ВЫБИРАЙ СВОЁ НАПРАВЛЕНИЕ</div><h2>${params.get('status') === 'favorite' ? 'Твоя коллекция курсов' : 'Учись тому, что пригодится'}</h2><p>Каждая программа ведёт от первого понятия к самостоятельному результату.</p></div><div class="catalog-total"><strong>${result.total}</strong><span>курсов<br>в каталоге</span></div></div>
  <form id="catalog-form"><section class="catalog-controls" aria-label="Поиск и фильтры курсов"><div class="catalog-search-row"><label class="catalog-search"><span class="sr-only">Поиск курсов</span><span class="search-mark" aria-hidden="true">⌕</span><input name="q" value="${esc(params.get('q') || '')}" placeholder="Найдите курс по теме или навыку…"></label><button class="catalog-search-button" type="submit">Найти курс <span aria-hidden="true">↗</span></button></div><div class="catalog-filter-heading"><div><span class="filter-kicker">ТОЧНЫЙ ПОДБОР</span><h3>Подберите программу</h3></div><button type="button" class="filter-reset" data-action="reset-filter">Очистить фильтры <span aria-hidden="true">↺</span></button></div><div class="catalog-filter-grid"><div class="catalog-filter-field"><label for="category_id"><span class="filter-symbol">01</span> Направление</label><select id="category_id" name="category_id"><option value="">Все направления</option>${state.categories.map(c => `<option value="${c.id}" ${params.get('category_id') === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div><div class="catalog-filter-field"><label for="level"><span class="filter-symbol">02</span> Уровень сложности</label><select id="level" name="level"><option value="">Любой уровень</option>${['Начальный', 'Средний', 'Продвинутый'].map(v => `<option ${params.get('level') === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div><div class="catalog-filter-field"><label for="status"><span class="filter-symbol">03</span> Статус записи</label><select id="status" name="status">${[['', 'Все курсы'], ['new', 'Ещё не записан'], ['enrolled', 'Уже записан'], ['favorite', 'Избранное']].map(([v, l]) => `<option value="${v}" ${params.get('status') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div></section><section class="catalog-results"><div class="catalog-results-head"><p class="count"><strong>${result.total}</strong> ${result.total===1?'программа':result.total>1&&result.total<5?'программы':'программ'} найдено</p><label class="catalog-sort"><span>Сортировать</span><select name="sort"><option value="new">Сначала новые</option><option value="popular" ${params.get('sort') === 'popular' ? 'selected' : ''}>Сначала популярные</option></select></label></div><div class="grid">${result.items.map(c => card(c)).join('')}</div>${!result.items.length ? empty('Пока ничего не найдено', 'Попробуйте изменить запрос или очистить фильтры.') : ''}<div class="pagination">${Array.from({length: result.pages}, (_, i) => `<button type="button" class="small ${result.page === i + 1 ? 'current' : 'secondary'}" data-action="page" data-page="${i + 1}" aria-label="Страница ${i + 1}">${i + 1}</button>`).join('')}</div></section></form>`;
}
function program(plan) {
  const modules=new Map();plan.forEach(l=>{if(!modules.has(l.module_id))modules.set(l.module_id,{title:l.module_title,description:l.module_description,outcomes:l.module_outcomes,lessons:[]});modules.get(l.module_id).lessons.push(l);});
  return [...modules.values()].map((m,i)=>`<details class="program-module" open><summary>${String(i+1).padStart(2,'0')} &nbsp; ${esc(m.title)}</summary>${m.description?`<p class="muted">${esc(m.description)}</p>`:''}${m.outcomes?`<small class="muted">Результат: ${esc(m.outcomes)}</small>`:''}${m.lessons.map(l=>`<div class="lesson-row"><span>${l.state==='completed'?'✓':l.has_quiz?'◇':'▤'} &nbsp; ${l.accessible?`<a class="subtle-link" href="/learn/${l.id}">${esc(l.title)}</a>`:esc(l.title)}</span><span class="muted">${l.minutes} мин</span></div>`).join('')}</details>`).join('');
}
async function coursePage(id) {
  const c=await api('/courses/'+id);
  return `<div class="breadcrumbs"><a href="/courses">Каталог курсов</a> / ${esc(c.category||'Курс')}</div><section class="detail-hero"><div><div class="eyebrow">${esc(c.category)} · ${esc(c.level)}</div><h1>${esc(c.title)}</h1><p class="muted">${esc(c.summary)}</p><div class="detail-facts"><span>▤ ${c.lesson_count} уроков</span><span>◷ ${duration(c.minutes)}</span><span>♙ ${c.enrolled_count} участников</span></div><div class="actions">${c.enrollment?`<a class="button" href="/learn/${c.resume}">${c.enrollment.completed_at?'Повторить курс':c.progress?'Продолжить обучение':'Начать обучение'} ↗</a>`:`<button data-action="enroll" data-id="${c.id}">Записаться на курс ↗</button>`}<button class="secondary" data-action="favorite" data-id="${c.id}" data-enabled="${!c.favorite}">${c.favorite?'♥ В избранном':'♡ В избранное'}</button></div>${c.enrollment?`<progress value="${c.progress}" max="100"></progress><small>${c.progress}% · ${c.done} из ${c.lesson_count} уроков</small>`:''}${c.status==='archived'?'<p class="notice">Курс в архиве. Ваши материалы и история доступны.</p>':''}</div><div class="cover">${c.cover?`<img src="${esc(c.cover)}" alt="Обложка курса">`:'<div class="cover-fallback">↗</div>'}</div></section><div class="two-col"><div><section class="panel"><h2>О курсе</h2><p>${esc(c.description).replace(/\n/g,'<br>')}</p><h3>Чему вы научитесь</h3><ul class="outcomes">${c.outcomes.split('\n').filter(Boolean).map(x=>`<li>${esc(x)}</li>`).join('')}</ul></section><section class="panel"><h2>Программа курса</h2><p class="muted">${c.progression==='free'?'После записи доступны все уроки. Завершённые уроки можно повторять.':'Уроки открываются последовательно. Завершённые доступны для повторения.'}</p>${program(c.lessons)}</section><section class="panel"><h2>Отзывы участников <span class="stars">${c.rating?'★ '+c.rating:''}</span></h2>${c.reviews.length?c.reviews.map(r=>`<article class="review"><strong>${esc(r.name)}</strong> <span class="stars">${'★'.repeat(r.rating)}</span><p>${esc(r.text)}</p><small class="muted">${date(r.created_at)}</small></article>`).join(''):empty('Первый отзыв может быть вашим','Завершите курс и поделитесь впечатлениями.')}${c.enrollment?.completed_at?`<form id="review-form" data-id="${id}" class="spaced"><h3>Ваш отзыв</h3><div class="field"><label for="rating">Оценка</label><select name="rating" id="rating">${[5,4,3,2,1].map(n=>`<option value="${n}">${n} из 5</option>`).join('')}</select></div>${area('Впечатления от курса','text','','required minlength="5" maxlength="2000"')}<p class="form-error" role="alert"></p><button>Сохранить отзыв</button></form>`:''}</section></div><aside><section class="panel"><h3>Что понадобится</h3><p class="muted">${esc(c.prerequisites||'Специальная подготовка не требуется.')}</p><h3>Ваш результат</h3><p class="muted">Практические навыки, личные заметки и именной сертификат в PDF.</p><div class="notice">Ваш прогресс сохраняется. Возвращайтесь к обучению с любого устройства.</div></section></aside></div>`;
}
function authPage(register=false) {
  const namePattern='pattern="[\\p{L}]+(?:[ ]+[\\p{L}]+)*" title="Только буквы и пробелы"';
  const consents=register?`<fieldset class="consent-checks"><legend>Подтверждения для регистрации</legend><label class="consent-item"><input type="checkbox" name="policy_version" value="privacy-2026-11-v1" required><span>Я ознакомился(ась) с <a class="subtle-link" href="/privacy">Политикой обработки персональных данных</a>.</span></label><label class="consent-item"><input type="checkbox" name="pd_consent_version" value="consent-2026-11-v1" required><span>Даю отдельное согласие на обработку персональных данных для регистрации и работы платформы. <a class="subtle-link" href="/privacy#consent">Условия согласия</a>.</span></label></fieldset>`:'';
  return `<div class="auth-layout"><div class="auth-art"><div class="eyebrow">Вектор вашего развития</div><h2>Большие перемены<br>начинаются<br>с первого шага.</h2><p>Откройте новые направления, учитесь в своём темпе и замечайте свой прогресс.</p><span>↗ &nbsp; Знания остаются с вами</span></div><form class="auth-form" id="${register?'register':'login'}-form"><h1>${register?'Создайте аккаунт':'С возвращением'}</h1><p class="muted">${register?'Ваше пространство для новых знаний.':'Продолжим с того места, где остановились.'}</p>${register?field('Ваше имя','name','','text',`required minlength="2" maxlength="80" autocomplete="name" ${namePattern}`):''}${field('Электронная почта','email','','email','required maxlength="254" autocomplete="email"')}${field('Пароль','password','','password',`required minlength="${register?10:1}" maxlength="128" autocomplete="${register?'new-password':'current-password'}"`)}${register?'<p class="hint">Имя — только буквы и пробелы. Пароль — не менее 10 символов.</p>':''}${consents}<p class="form-error" role="alert"></p><button>${register?'Зарегистрироваться':'Войти в аккаунт'} ↗</button><p class="hint spaced">${register?'Уже есть аккаунт? <a href="/auth" class="subtle-link">Войти</a>':'Ещё нет аккаунта? <a href="/register" class="subtle-link">Зарегистрироваться</a>'}</p></form></div>`;
}
function privacyPage() {
  return `<article class="panel privacy-page"><div class="eyebrow">ПЕРСОНАЛЬНЫЕ ДАННЫЕ</div><h1>Правила обработки персональных данных</h1><p class="notice">Учебная версия платформы «Вектор». Перед публичным запуском владелец должен указать своё полное имя или наименование, адрес и контакт для обращений субъектов данных.</p><h2>Оператор и связь</h2><p>Оператором является владелец экземпляра платформы «Вектор». Его полные реквизиты и контактный адрес должны быть опубликованы владельцем перед сбором данных в рабочей среде.</p><h2>Какие данные используются</h2><p>Имя, адрес электронной почты, пароль в виде стойкого хеша, аватар по желанию, записи на курсы, результаты обучения, тестов, заметки, отзывы и технические события работы аккаунта.</p><h2>Для чего и как</h2><p>Данные нужны для создания и защиты аккаунта, предоставления обучения, сохранения прогресса, проверки заданий, выдачи сертификатов, показа уведомлений и поддержки работоспособности сервиса. Данные не продаются и не используются для рекламного профилирования.</p><h2>Срок хранения и удаление</h2><p>Данные хранятся, пока аккаунт нужен для работы платформы и ведения учебной истории. Запрос на прекращение обработки или удаление следует направить оператору по опубликованному им адресу; оператор проверяет запрос и учитывает обязанности по сохранению учебных и бухгалтерских записей, если они применимы.</p><h2 id="consent">Отдельное согласие</h2><p>При регистрации согласие подтверждается отдельным, заранее не отмеченным флажком. Оно охватывает имя, email, хеш пароля, учебный прогресс и действия в платформе для целей, перечисленных выше. Отзыв согласия направляется оператору по его опубликованному контактному адресу. Версия согласия и дата подтверждения сохраняются в аккаунте.</p><p class="hint">Правовая основа: Федеральный закон № 152-ФЗ «О персональных данных», в том числе требование оформлять согласие отдельно от других документов и информации.</p><a class="button secondary" href="/register">Вернуться к регистрации</a></article>`;
}
async function dashboardPage() {
  const d=await api('/dashboard');const active=d.courses.filter(c=>!c.enrollment.completed_at);const done=d.courses.filter(c=>c.enrollment.completed_at);const next=active[0];
  return `<div class="section-heading dashboard-heading"><div><div class="eyebrow">Личное пространство</div><h1>Рады видеть вас, ${esc(state.user.name.split(' ')[0])}</h1><p class="muted">Каждый урок — ещё один шаг к вашей цели.</p></div><a class="button secondary" href="/courses">Выбрать курс ↗</a></div><div class="stats"><div class="stat"><span>Курсов в процессе</span><strong>${active.length}</strong></div><div class="stat"><span>Курсов завершено</span><strong>${d.stats.courses}</strong></div><div class="stat"><span>Уроков пройдено</span><strong>${d.stats.lessons}</strong></div><div class="stat"><span>Средний результат тестов</span><strong>${d.stats.score}%</strong></div></div>${next?`<section class="continue"><div class="continue-copy"><div class="eyebrow">Продолжить обучение</div><h2>${esc(next.title)}</h2><p>${next.done} из ${next.lesson_count} уроков завершено</p>${next.resume_title?`<p class="continue-next"><span>Следующий шаг</span><strong>${esc(next.resume_title)}</strong><small>${esc(next.resume_module_title||'')} · ${duration(next.resume_minutes||0)} · осталось около ${duration(next.remaining_minutes||0)}</small></p>`:''}<div class="continue-progress"><progress value="${next.progress}" max="100" aria-label="Прогресс по курсу ${esc(next.title)}"></progress><strong>${next.progress}%</strong></div></div>${next.cover?`<img class="continue-cover" src="${esc(next.cover)}" alt="" loading="lazy">`:''}<a href="/learn/${next.resume}" class="button">Вернуться к уроку <span aria-hidden="true">→</span></a></section>`:empty('Время для нового открытия','<a href="/courses" class="subtle-link">Выберите курс в каталоге →</a>')}<section class="panel goal-panel"><div class="section-heading"><div><div class="eyebrow">Личный ритм</div><h2>Учебная цель на неделю</h2></div><strong>${d.study_minutes} / ${d.goal.weekly_minutes} мин</strong></div><progress value="${Math.min(100,Math.round(d.study_minutes/d.goal.weekly_minutes*100))}" max="100" aria-label="Прогресс недельной цели"></progress><p class="hint">Учтена плановая длительность открытых уроков за 7 дней, это оценка учебной нагрузки, а не таймер фактического времени.</p><form id="goal-form" class="editor-grid spaced">${field('Минут в неделю','weekly_minutes',d.goal.weekly_minutes,'number','min="15" max="2400" required')}${field('Время напоминания','reminder_time',d.goal.reminder_time,'time','required')}<label class="option"><input type="checkbox" name="reminder_enabled" ${d.goal.reminder_enabled?'checked':''}> Напоминать, если отстаю от цели</label><button>Сохранить цель</button><p class="hint wide">Напоминания появляются в уведомлениях кабинета. Для их создания запускайте планировщик командой <code>flask --app app send-learning-reminders</code>.</p></form></section><div class="section-heading"><h2>Курсы в процессе</h2><span class="muted">${active.length}</span></div><div class="grid dashboard-grid">${active.map(c=>card(c,true)).join('')}</div>${!active.length?'<p class="muted">Здесь появятся курсы, на которые вы запишетесь.</p>':''}<div class="section-heading"><h2>Завершённые курсы</h2><span class="muted">${done.length}</span></div><div class="grid dashboard-grid">${done.map(c=>card(c,true)).join('')}</div>${!done.length?'<p class="muted">Всё впереди — завершите первый курс.</p>':''}<div class="two-col spaced"><section class="panel"><h2>История обучения</h2>${d.events.length?`<ul class="timeline">${d.events.map(e=>`<li>${esc(e.text)}<time>${date(e.created_at)}</time></li>`).join('')}</ul>`:empty('История пока пуста','События появятся после начала обучения.')}</section><div><section class="panel notifications"><div class="section-heading"><h2>Уведомления</h2><button class="ghost small" data-action="read-notifications">Прочитано</button></div>${d.notifications.map(n=>`<p>${n.seen?'':'● '}${esc(n.text)}<br><small class="muted">${date(n.created_at)}</small></p>`).join('')||'<p class="muted">Новых уведомлений нет.</p>'}</section><section class="panel"><h2>Ваши сертификаты</h2>${d.certificates.map(c=>`<article class="certificate-card"><div class="certificate-art" aria-hidden="true"><span>В</span><i>✦</i></div><div class="certificate-copy"><div class="eyebrow">СЕРТИФИКАТ ВЕКТОР</div><h3>${esc(c.course)}</h3><small>Выдан ${date(c.issued_at)}<br>№ ${esc(c.id)}</small><div class="certificate-actions"><a class="button small secondary" href="/verify/${encodeURIComponent(c.id)}">Проверить подлинность ↗</a><a class="button small" href="/api/certificates/${encodeURIComponent(c.id)}/pdf" download>Скачать PDF ↓</a></div></div><span class="certificate-seal" aria-hidden="true">✓</span></article>`).join('')||'<p class="muted">Завершите курс, чтобы получить именной сертификат.</p>'}</section></div></div>`;
}
function profilePage() {
  return `<div class="eyebrow">Настройки аккаунта</div><h1>Ваш профиль</h1><div class="two-col"><form id="profile-form" class="panel">${avatar(state.user,'profile-avatar')}<h2>Личные данные</h2>${field('Имя','name',state.user.name,'text','required minlength="2" maxlength="80" pattern="[\\p{L}]+(?:[ ]+[\\p{L}]+)*" title="Только буквы и пробелы"')}${field('Email','email',state.user.email,'email','disabled')}<input type="hidden" name="avatar" value="${esc(state.user.avatar)}"><div class="field"><label for="avatar-file">Аватар · JPG, PNG или WebP</label><input id="avatar-file" type="file" accept="image/png,image/jpeg,image/webp" data-upload="avatar"><p class="hint">До 8 МБ. Изображение будет оптимизировано.</p></div><p class="form-error" role="alert"></p><button>Сохранить профиль</button></form><form id="password-form" class="panel"><h2>Смена пароля</h2>${field('Текущий пароль','current','','password','required autocomplete="current-password"')}${field('Новый пароль','password','','password','required minlength="10" maxlength="128" autocomplete="new-password"')}<p class="hint">После смены пароля другие сессии будут завершены.</p><p class="form-error" role="alert"></p><button>Изменить пароль</button></form></div>`;
}
async function verifyCertificate(id) {
  const {certificate}=await api(`/certificates/${encodeURIComponent(id)}/verify`);
  return `<section class="certificate-verification"><div class="verification-orbit" aria-hidden="true"><span>✓</span></div><div class="eyebrow">РЕЕСТР ДОСТИЖЕНИЙ · ВЕКТОР</div><span class="verification-status"><i></i> Подлинность подтверждена</span><h1>Сертификат действителен</h1><p class="muted">Этот документ выдан образовательной платформой «Вектор».</p><div class="verification-details"><span>Выпускник</span><strong>${esc(certificate.name)}</strong><span>Завершённая программа</span><strong>${esc(certificate.course)}</strong><span>Дата выдачи</span><strong>${date(certificate.issued_at)}</strong><span>Номер сертификата</span><strong class="verification-id">${esc(certificate.id)}</strong></div><a class="button secondary" href="/courses">Перейти в каталог ↗</a></section>`;
}
function assignmentBlock(a,id) {
  if(!a)return '';
  const sub=a.submission;const scores=sub?.rubric_scores||{};
  const rubric=sub?`<div class="rubric-result"><h4>Оценка по критериям</h4>${a.rubric.map(r=>`<p>${esc(r.title)} <strong>${scores[r.id]??0}/${r.max_score}</strong></p>`).join('')}</div>`:'';
  return `<section class="panel assignment-card"><div class="eyebrow">Практика с обратной связью</div><h2>${esc(a.title)}</h2><div class="rich">${esc(a.instructions).replace(/\n/g,'<br>')}</div><h3>Как оценивается</h3><ul>${a.rubric.map(r=>`<li>${esc(r.title)} — до ${r.max_score} баллов</li>`).join('')}</ul>${sub?`<div class="notice">Статус: <strong>${sub.status==='approved'?'Принята':sub.status==='revision'?'На доработке':'Отправлена на проверку'}</strong>${sub.score!==null?` · ${sub.score}/${a.max_score} баллов`:''}</div>${sub.feedback?`<blockquote>${esc(sub.feedback)}</blockquote>`:''}${rubric}${sub.file_name?`<a href="/api/media/${sub.attachment_id}" class="subtle-link">Сданный файл: ${esc(sub.file_name)}</a>`:''}`:''}${sub?.status==='approved'?'<p class="success-text">Практика зачтена. Ваш прогресс сохранён.</p>':`<form id="assignment-form" data-id="${id}">${a.submission_type==='text'?area('Ваше решение','body',sub?.body||'','rows="8" minlength="10" required maxlength="20000"'):a.submission_type==='url'?field('Ссылка на результат','body',sub?.body||'','url','required placeholder="https://…"'): `<div class="field"><label for="assignment-file">Файл результата (PDF, TXT или CSV)</label><input id="assignment-file" type="file" accept=".pdf,.txt,.csv" data-upload="assignment" data-lid="${id}"><small id="assignment-upload-name">${state.assignmentUpload?'Файл загружен':sub?.file_name?esc(sub.file_name):'До 8 МБ'}</small></div>`}<p class="hint">${sub?.status==='revision'?'Внесите правки и отправьте работу повторно.':'После отправки работа попадёт в очередь проверки.'}</p><p class="form-error" role="alert"></p><button>${sub?'Отправить исправленную версию':'Сдать практическую работу'} →</button></form>`}</section>`;
}
function feedbackBlock(a) {return `<div class="feedback ${a.passed?'':'fail'}"><h3>${a.passed?'✓ Тест пройден':'Попробуйте ещё раз'} · ${a.score}%</h3>${a.feedback.map(f=>`<p><strong>${f.correct?'✓':'✕'} ${esc(f.text)}</strong><br>${esc(f.explanation)}<br><small>Верный ответ: ${esc(f.answer.join(', '))}</small></p>`).join('')}</div>`;}
function readerToolbar() {
  const sizes=[['small','А− 15 px'],['normal','А 18 px'],['large','А+ 22 px']];
  const widths=[['narrow','Узкая'],['normal','Обычная'],['wide','Широкая']];
  return `<div class="reader-toolbar" aria-label="Настройки чтения"><div role="group" aria-label="Размер текста"><span>Размер текста</span>${sizes.map(([value,label])=>`<button type="button" class="reader-choice ${state.reader.size===value?'selected':''}" data-action="reader-setting" data-setting="size" data-value="${value}" aria-pressed="${state.reader.size===value}">${label}</button>`).join('')}</div><div role="group" aria-label="Ширина текста"><span>Ширина строки</span>${widths.map(([value,label])=>`<button type="button" class="reader-choice ${state.reader.width===value?'selected':''}" data-action="reader-setting" data-setting="width" data-value="${value}" aria-pressed="${state.reader.width===value}">${label}</button>`).join('')}</div><span class="reader-status" aria-live="polite">Текст ${state.reader.size==='small'?'15':state.reader.size==='large'?'22':'18'} px · ${widths.find(([value])=>value===state.reader.width)?.[1].toLowerCase()} строка</span></div>`;
}
function previewSafeHtml(value) {
  const parsed=new DOMParser().parseFromString(String(value||''),'text/html');
  const allowed=new Set(['P','BR','H2','H3','STRONG','EM','UL','OL','LI','BLOCKQUOTE','CODE','PRE','A']);
  const render=node=>{
    if(node.nodeType===Node.TEXT_NODE)return esc(node.nodeValue);
    if(node.nodeType!==Node.ELEMENT_NODE)return '';
    if(['SCRIPT','STYLE','IFRAME','SVG','MATH','OBJECT','TEMPLATE'].includes(node.tagName))return '';
    const children=[...node.childNodes].map(render).join('');
    if(!allowed.has(node.tagName))return children;
    if(node.tagName==='A'){
      const href=node.getAttribute('href')||'';
      return /^https:\/\//i.test(href)?`<a href="${esc(href)}" rel="noopener noreferrer" target="_blank">${children}</a>`:children;
    }
    const tag=node.tagName.toLowerCase();
    return tag==='br'?'<br>':`<${tag}>${children}</${tag}>`;
  };
  return [...parsed.body.childNodes].map(render).join('');
}
function previewItems() {
  return state.preview.course.modules.flatMap((module,moduleIndex)=>module.lessons.map(lesson=>({module,moduleIndex,lesson})));
}
function previewIsUnlocked(index) {
  const items=previewItems();const {course,completed}=state.preview;
  if(course.progression!=='free'&&!items.slice(0,index).every((_,prior)=>completed.includes(prior)))return false;
  const prerequisite=items[index]?.module?.unlock_after_module_id;
  if(prerequisite){const required=items.map((item,i)=>item.module.id===Number(prerequisite)?i:null).filter(i=>i!==null);if(!required.length||!required.every(i=>completed.includes(i)))return false;}
  return true;
}
function previewCanComplete(index) {
  const item=previewItems()[index];if(!item)return false;
  const testPassed=!item.lesson.quiz||Boolean(state.preview.results[index]?.passed);
  const assignmentPassed=!item.lesson.assignment?.required||state.preview.approvedAssignments.includes(index);
  return testPassed&&assignmentPassed;
}
function renderStudentPreview() {
  if(!state.preview)return;
  document.body.classList.add('student-preview');
  const {course,current,completed,results}=state.preview;const items=previewItems();
  if(!items.length){$('#main').innerHTML=adminShell(`<div class="section-heading"><h1>Предпросмотр курса</h1><button class="secondary" data-action="back-editor">← В редактор</button></div>${empty('В программе пока нет уроков','Добавьте урок в редакторе, чтобы посмотреть курс глазами ученика.')}`,'courses');return;}
  if(current>=items.length){state.preview.current=0;return renderStudentPreview();}
  const item=items[current];const lesson=item.lesson;const quizResult=results[current];let lastModule=-1;
  const outline=items.map((entry,index)=>{
    let heading='';if(lastModule!==entry.moduleIndex){lastModule=entry.moduleIndex;heading=`<h4>${esc(entry.module.title)}</h4>`;}
    const unlocked=previewIsUnlocked(index);const status=completed.includes(index)?'Завершён':unlocked?'Доступен':'Закрыт';
    const body=`<span class="preview-status">${completed.includes(index)?'✓':unlocked?'○':'▣'}</span><span>${esc(entry.lesson.title)}<small>${entry.lesson.minutes||15} мин · ${status}</small></span>`;
    return heading+(unlocked?`<button type="button" class="preview-lesson ${current===index?'current':''}" data-action="preview-select" data-index="${index}">${body}</button>`:`<div class="preview-lesson locked">${body}<small class="preview-lock-hint">${course.progression==='free'?'Требуется завершить модуль-предшественник':'Сначала завершите предыдущий урок'}</small></div>`);
  }).join('');
  const quiz=lesson.quiz?`<section class="spaced"><h2>Проверьте себя</h2><p class="muted">Проходной балл: ${Number(lesson.quiz.pass_score)||70}%. Тест работает только в этом предпросмотре.</p><form id="preview-quiz-form" data-index="${current}">${lesson.quiz.questions.map((question,qi)=>`<fieldset class="quiz-question"><legend>${qi+1}. ${esc(question.text)}</legend>${question.options.map((option,oi)=>`<label class="option"><input type="${question.correct.length>1?'checkbox':'radio'}" name="preview-q-${qi}" value="${oi}" required>${esc(option)}</label>`).join('')}</fieldset>`).join('')}<button>Проверить ответы →</button></form>${quizResult?feedbackBlock(quizResult):''}</section>`:'';
  const assignment=lesson.assignment?`<section class="panel assignment-card"><div class="eyebrow">Задание ученика</div><h2>${esc(lesson.assignment.title)}</h2><p>${esc(lesson.assignment.instructions)}</p><p class="hint">Форма сдачи: ${lesson.assignment.submission_type==='url'?'ссылка':lesson.assignment.submission_type==='file'?'файл':'текст'} · до ${lesson.assignment.max_score||100} баллов</p></section>`:'';
  const assignmentStep=lesson.assignment?.required&&!state.preview.approvedAssignments.includes(current)?`<div class="preview-assignment-step"><p class="hint">В рабочем курсе работу проверяет преподаватель. Здесь можно только посмотреть следующий шаг.</p><button type="button" class="secondary small" data-action="preview-approve-assignment" data-index="${current}">Имитировать принятие работы</button></div>`:'';
  const materials=(lesson.materials||[]).map(material=>`<p><a class="subtle-link" href="/api/media/${material.id}" target="_blank" rel="noopener">↗ ${esc(material.name)}</a></p>`).join('');
  const outcomes=String(course.outcomes||'').split('\n').filter(Boolean).map(value=>`<li>${esc(value)}</li>`).join('');
  const cover=course.cover?`<img src="${esc(course.cover)}" alt="Обложка курса">`:'';
  const content=`<div class="section-heading"><div><div class="eyebrow">ПРЕДПРОСМОТР · ${esc(course.level||'')}</div><h1>${esc(course.title)}</h1></div><button type="button" class="secondary small" data-action="back-editor">← В редактор</button></div><div class="notice preview-simulation-note">${state.dirty?'Показан текущий черновик — изменения не сохраняются. ':''}Режим ученика: переходы и тесты работают локально. Попытки и прогресс курса не сохраняются.</div><section class="preview-course-intro"><div class="preview-course-cover">${cover}</div><div><div class="eyebrow">${esc(course.category||'КУРС')} · ${esc(course.level||'')}</div><p>${esc(course.summary||course.description||'')}</p><p class="hint">${items.length} уроков · около ${duration(course.minutes||items.reduce((sum,entry)=>sum+(Number(entry.lesson.minutes)||15),0))}</p>${course.prerequisites?`<p><strong>Подготовка:</strong> ${esc(course.prerequisites)}</p>`:''}${outcomes?`<details><summary>Результаты обучения</summary><ul>${outcomes}</ul></details>`:''}</div></section><div class="preview-layout"><aside class="lesson-nav preview-outline"><details open><summary>Программа · ${completed.length} из ${items.length} уроков</summary><progress max="${items.length}" value="${completed.length}"></progress>${outline}</details></aside><article class="lesson-content" data-reader-size="${state.reader.size}" data-reader-width="${state.reader.width}"><div class="lesson-heading"><div class="eyebrow">Урок ${current+1} из ${items.length} · ${lesson.minutes||15} минут</div><h2>${esc(lesson.title||'Новый урок')}</h2>${completed.includes(current)?'<span class="badge green">✓ Завершён в предпросмотре</span>':'<span class="badge">Доступен</span>'}</div>${readerToolbar()}${item.module.description?`<p class="notice">${esc(item.module.description)}</p>`:''}${item.module.outcomes?`<p class="hint"><strong>Результат модуля:</strong> ${esc(item.module.outcomes)}</p>`:''}<div class="rich lesson-reading">${previewSafeHtml(lesson.content)}</div>${lesson.video?`<iframe class="video" title="Видео урока" src="${esc(lesson.video)}" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>`:''}${materials}${assignment}${assignmentStep}${quiz}${!lesson.quiz&&previewCanComplete(current)?`<button type="button" class="spaced" data-action="preview-complete" data-index="${current}">${completed.includes(current)?'Урок завершён ✓':'Завершить урок в предпросмотре'}</button>`:quizResult?.passed&&previewCanComplete(current)?'<p class="success-text">Тест пройден, урок зачтён только в предпросмотре.</p>':quizResult?.passed?'<p class="hint">Тест пройден. Имитируйте принятие обязательной практической работы.</p>':quizResult?'<p class="hint">Наберите проходной балл, чтобы открыть следующий урок.</p>':''}<div class="lesson-controls">${current>0&&previewIsUnlocked(current-1)?`<button type="button" class="secondary" data-action="preview-select" data-index="${current-1}">← Предыдущий урок</button>`:'<span></span>'}${current+1<items.length&&previewIsUnlocked(current+1)?`<button type="button" data-action="preview-select" data-index="${current+1}">Следующий урок →</button>`:current+1<items.length?'<span class="hint">Завершите урок, чтобы открыть следующий</span>':'<span class="muted">Последний урок программы</span>'}</div></article></div>`;
  $('#main').innerHTML=adminShell(content,'courses');document.body.classList.add('student-preview');
}
async function lessonPage(id) {
  await api(`/lessons/${id}/open`,'POST',{});const l=await api('/lessons/'+id);state.lesson=l;
  const index=l.plan.findIndex(x=>x.id===Number(id));const current=l.plan[index];const prev=l.plan[index-1];const next=l.plan[index+1];let module='';
  return `<div class="breadcrumbs"><a href="/dashboard">Моё обучение</a> / <a href="/courses/${l.course_id}">${esc(l.course.title)}</a></div><div class="learning"><aside class="lesson-nav"><details ${innerWidth>760?'open':''}><summary>Программа курса · ${l.course.progress}%</summary><progress value="${l.course.progress}" max="100"></progress>${l.plan.map(p=>{let h='';if(module!==p.module_title){module=p.module_title;h=`<h4>${esc(module)}</h4>`;}return h+(p.accessible?`<a href="/learn/${p.id}" class="${p.id===l.id?'current':''}"><span>${p.state==='completed'?'✓':p.state==='started'?'◉':'○'}</span><span>${esc(p.title)}<small>${p.minutes} мин · ${p.state==='completed'?'Завершён':p.state==='started'?'Начат':'Доступен'}</small></span></a>`:`<div class="locked"><span>▣</span><span>${esc(p.title)}<small>${esc(p.lock_reason||'Сначала завершите предыдущий урок')}</small></span></div>`);}).join('')}</details></aside><section><article class="lesson-content" data-reader-size="${state.reader.size}" data-reader-width="${state.reader.width}"><div class="lesson-heading"><div class="eyebrow">Урок ${index+1} из ${l.plan.length} · ${l.minutes} минут</div><h1>${esc(l.title)}</h1>${current.state==='completed'?'<span class="badge green">✓ Урок завершён</span>':'<span class="badge">В процессе</span>'}</div>${readerToolbar()}${current.module_description?`<p class="notice">${esc(current.module_description)}</p>`:''}<div class="rich lesson-reading">${l.content}</div>${l.video?`<iframe class="video" title="Видео урока" src="${esc(l.video)}" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe><p class="hint">При возвращении сохраняется последний урок. Позиция внешнего видео не сохраняется.</p>`:''}${l.materials.length?`<h3>Материалы урока</h3>${l.materials.map(m=>m.kind==='image'?`<figure><img src="/api/media/${m.id}" alt="${esc(m.name)}"><figcaption>${esc(m.name)}</figcaption></figure>`:`<p><a class="button secondary small" href="/api/media/${m.id}" download>↓ ${esc(m.name)}</a></p>`).join('')}`:''}${l.quiz?`<section class="spaced"><h2>Проверьте себя</h2><p class="muted">Проходной балл: ${l.quiz.pass_score}%. В вопросе может быть несколько правильных ответов.</p><form id="quiz-form" data-id="${id}">${l.quiz.questions.map((q,i)=>`<fieldset class="quiz-question"><legend>${i+1}. ${esc(q.text)}</legend>${q.options.map((o,j)=>`<label class="option"><input type="${q.multiple?'checkbox':'radio'}" name="q-${q.id}" value="${j}">${esc(o)}</label>`).join('')}</fieldset>`).join('')}<p class="form-error" role="alert"></p><button>Проверить ответы →</button></form><div id="quiz-result"></div>${l.attempts.length?`<details class="spaced"><summary>История попыток (${l.attempts.length})</summary>${l.attempts.map(a=>`<details class="panel spaced"><summary>${date(a.created_at)} · ${a.score}% · ${a.passed?'Зачёт':'Не зачтено'}</summary>${feedbackBlock(a)}</details>`).join('')}</details>`:''}</section>`:`<button class="spaced" data-action="complete" data-id="${id}">${current.state==='completed'?'Урок уже завершён ✓':'Завершить урок ✓'}</button>`}${assignmentBlock(l.assignment,id)}<form id="note-form" data-id="${id}" class="notes"><h3>Личные заметки</h3><p class="hint">Видны только вам. Сохраните важные мысли и вопросы.</p>${area('Заметка к уроку','note',l.note.text,'maxlength="10000"')}<p class="form-error" role="alert"></p><button class="secondary small">Сохранить заметку</button></form><div class="lesson-controls">${prev?.accessible?`<a class="button secondary" href="/learn/${prev.id}">← Предыдущий урок</a>`:'<span></span>'}${next?.accessible?`<a class="button" href="/learn/${next.id}">Следующий урок →</a>`:next?'<span class="hint">Завершите урок, чтобы продолжить</span>':l.course.enrollment.completed_at?'<a class="button" href="/dashboard">К сертификату ◇</a>':''}</div></article></section></div>`;
}
function adminShell(content, tab='overview') {
  return `<div class="admin-layout"><aside class="admin-nav"><h4>Панель управления</h4>${[['overview','◫','Обзор','/admin'],['courses','▤','Курсы','/admin/courses'],['users','♙','Пользователи','/admin/users'],['reviews','✎','Проверка работ','/admin/reviews'],['analytics','↗','Аналитика','/admin/analytics'],['audit','≡','Журнал действий','/admin/audit']].map(([id,icon,label,href])=>`<a href="${href}" class="${tab===id?'active':''}">${icon} &nbsp; ${label}</a>`).join('')}</aside><div class="admin-main">${content}</div></div>`;
}
async function adminOverview(analytics=false) {
  const days=new URLSearchParams(location.search).get('days')||30;const d=await api('/admin/overview?days='+days);
  const max=Math.max(1,...d.registrations.map(x=>x.count),...d.enrollments.map(x=>x.count));
  const allDays=Array.from({length:Number(days)},(_,i)=>{const v=new Date();v.setUTCDate(v.getUTCDate()-Number(days)+1+i);return v.toISOString().slice(0,10);});
  const chart=allDays.map(day=>{const a=d.registrations.find(x=>x.day===day)?.count||0;const b=d.enrollments.find(x=>x.day===day)?.count||0;return `<div class="chart-day" title="${day}: регистрации ${a}, записи ${b}"><div class="chart-bars"><meter min="0" max="${max}" value="${a}" aria-label="Регистрации ${day}: ${a}"></meter><meter class="blue" min="0" max="${max}" value="${b}" aria-label="Записи ${day}: ${b}"></meter></div><span>${day.slice(8)}</span></div>`;}).join('');
  return adminShell(`<div class="section-heading"><div><div class="eyebrow">Управление платформой</div><h1>${analytics?'Аналитика обучения':'Обзор платформы'}</h1><p class="muted">Актуальные данные о людях, курсах и результатах.</p></div><a href="/admin/courses" class="button small">Управлять курсами</a></div><div class="stats">${[['users','Пользователей'],['courses','Опубликовано курсов'],['enrollments','Записей на курсы'],['completed','Завершений курсов']].map(([k,v])=>`<div class="stat"><span>${v}</span><strong>${d.stats[k]}</strong></div>`).join('')}</div><section class="panel"><div class="section-heading"><h2>Рост платформы</h2><label><span class="sr-only">Период</span><select id="analytics-period">${[7,30,90].map(n=>`<option value="${n}" ${Number(days)===n?'selected':''}>Последние ${n} дней</option>`).join('')}</select></label></div><div class="legend"><span><b>●</b> Регистрации</span><span><b class="blue">●</b> Записи на курсы</span></div><div class="chart">${chart}</div><details><summary class="hint">Данные графика в таблице</summary><table><thead><tr><th>Дата (UTC)</th><th>Регистрации</th><th>Записи</th></tr></thead><tbody>${allDays.map(day=>`<tr><td>${day}</td><td>${d.registrations.find(x=>x.day===day)?.count||0}</td><td>${d.enrollments.find(x=>x.day===day)?.count||0}</td></tr>`).join('')}</tbody></table></details></section><h2>Популярные курсы</h2><div class="table-wrap"><table><thead><tr><th>Курс</th><th>Записи</th><th>Завершения</th><th>Доля завершений</th></tr></thead><tbody>${d.popular.map(c=>`<tr><td><a href="/admin/courses/${c.id}">${esc(c.title)}</a></td><td>${c.count}</td><td>${c.completed||0}</td><td>${c.count?Math.round(c.completed/c.count*100):0}%</td></tr>`).join('')}</tbody></table></div>${analytics?`<div class="two-col"><section class="panel"><h2>Средний прогресс по курсам</h2><div class="table-wrap"><table><thead><tr><th>Курс</th><th>Записи</th><th>Средний прогресс</th></tr></thead><tbody>${d.learning.map(c=>`<tr><td>${esc(c.title)}</td><td>${c.enrollments}</td><td>${c.avg_progress||0}%</td></tr>`).join('')}</tbody></table></div></section><section class="panel"><h2>Результаты тестов</h2><div class="table-wrap"><table><thead><tr><th>Курс</th><th>Попытки</th><th>Средний балл</th><th>Зачёты</th></tr></thead><tbody>${d.quiz_stats.map(c=>`<tr><td>${esc(c.title)}</td><td>${c.attempts}</td><td>${c.avg_score||0}%</td><td>${c.passed||0}</td></tr>`).join('')}</tbody></table></div></section></div>`:''}<section class="panel"><h2>Последняя активность</h2><ul class="timeline">${d.events.map(e=>`<li><strong>${esc(e.name)}</strong> · ${esc(e.text)}<time>${date(e.created_at)}</time></li>`).join('')||'<li>Событий пока нет.</li>'}</ul></section>`,analytics?'analytics':'overview');
}
async function adminCourses() {
  const courses=await api('/admin/courses');return adminShell(`<div class="section-heading"><div><div class="eyebrow">Учебные материалы</div><h1>Курсы</h1><p class="muted">От первого черновика до завершённого обучения.</p></div><button data-action="new-course">+ Создать курс</button></div><div class="table-wrap"><table><thead><tr><th>Название</th><th>Статус</th><th>Уроки</th><th>Участники</th><th>Действия</th></tr></thead><tbody>${courses.map(c=>`<tr><td><strong>${esc(c.title)}</strong><small>${esc(c.category||'Без категории')}</small></td><td>${badge(c.status)}</td><td>${c.lesson_count}</td><td>${c.enrolled_count}</td><td><div class="table-actions"><a class="button secondary small" href="/admin/courses/${c.id}">Изменить</a>${c.status!=='archived'?`<button class="danger small" data-action="archive" data-id="${c.id}">В архив</button>`:''}</div></td></tr>`).join('')}</tbody></table></div>${!courses.length?empty('Создайте первый курс','Добавьте программу, материалы и тесты.'):''}<form id="category-form" class="panel"><h3>Добавить направление</h3><div class="search-row"><input name="name" placeholder="Например, работа с данными" aria-label="Название направления" required minlength="2" maxlength="80"><button>Добавить</button></div><p class="form-error" role="alert"></p></form>`,'courses');
}
async function adminUsers() {
  const params=new URLSearchParams(location.search);const users=await api('/admin/users?'+params);return adminShell(`<div class="eyebrow">Участники платформы</div><h1>Пользователи</h1><form id="users-form" class="search-row"><input name="q" aria-label="Поиск пользователя" placeholder="Поиск по имени или email" value="${esc(params.get('q')||'')}"><select name="status" aria-label="Статус пользователя">${[['','Все аккаунты'],['active','Активные'],['blocked','Заблокированные']].map(([v,l])=>`<option value="${v}" ${params.get('status')===v?'selected':''}>${l}</option>`).join('')}</select><button>Найти</button></form><div class="table-wrap"><table><thead><tr><th>Пользователь</th><th>Роль</th><th>Статус</th><th>Действия</th></tr></thead><tbody>${users.map(u=>`<tr><td><a href="/admin/users/${u.id}"><strong>${esc(u.name)}</strong><small>${esc(u.email)}</small></a></td><td>${u.role==='admin'?'Администратор':'Пользователь'}</td><td><span class="badge ${u.blocked?'red':'green'}">${u.blocked?'Заблокирован':'Активен'}</span></td><td><button class="${u.blocked?'secondary':'danger'} small" data-action="block" data-id="${u.id}" data-blocked="${!u.blocked}">${u.blocked?'Разблокировать':'Заблокировать'}</button></td></tr>`).join('')}</tbody></table></div>${!users.length?empty('Нет подходящих пользователей','Измените запрос поиска.'):''}`,'users');
}
async function adminUser(id) {const d=await api('/admin/users/'+id);return adminShell(`<div class="breadcrumbs"><a href="/admin/users">Пользователи</a> / Профиль</div><h1>${esc(d.user.name)}</h1><p class="muted">${esc(d.user.email)} · Регистрация ${date(d.user.created_at)}</p><h2>Записи и прогресс</h2><div class="table-wrap"><table><thead><tr><th>Курс</th><th>Запись</th><th>Прогресс</th><th>Последняя активность</th></tr></thead><tbody>${d.courses.map(c=>`<tr><td>${esc(c.title)}</td><td>${date(c.enrollment.created_at)}</td><td>${c.done}/${c.lesson_count} · ${c.progress}%</td><td>${date(c.enrollment.last_activity)}</td></tr>`).join('')}</tbody></table></div>${!d.courses.length?empty('Записей пока нет','Пользователь ещё не начал обучение.'):''}`,'users');}
async function adminReviews() {
 const items=await api('/admin/assignments/reviews');
 return adminShell(`<div class="eyebrow">Обратная связь учащимся</div><h1>Проверка практических работ</h1>${items.map(x=>`<article class="panel review-work"><div class="eyebrow"><a href="/admin/courses/${x.course_id}">${esc(x.course_title)}</a> · ${esc(x.lesson_title)}</div><h2>${esc(x.assignment_title)}</h2><p><strong>${esc(x.user_name)}</strong> · ${esc(x.email)} · отправлено ${date(x.submitted_at)}</p>${x.body?`<div class="submission-body">${esc(x.body)}</div>`:''}${x.attachment_id?`<p><a class="button secondary small" href="/api/media/${x.attachment_id}">Скачать файл: ${esc(x.file_name||'работа')}</a></p>`:''}<form id="review-assignment-form" data-id="${x.id}" class="editor-grid">${field('Итоговый балл','score',x.score??'','number','min="0" max="1000" required')}${area('Комментарий и рекомендации','feedback',x.feedback||'','required minlength="2" maxlength="5000"')}${(x.rubric||[]).map(r=>field(`${r.title} (до ${r.max_score})`,'rubric_'+r.id,x.rubric_scores?.[r.id]||'', 'number',`min="0" max="${r.max_score}" data-rubric-score="${r.id}" required`)).join('')}<div class="field"><label for="review-status-${x.id}">Решение</label><select id="review-status-${x.id}" name="status"><option value="approved">Принять работу</option><option value="revision">Вернуть на доработку</option></select></div><p class="form-error wide" role="alert"></p><button>Сохранить проверку</button></form></article>`).join('')||empty('Очередь пуста','Новые работы появятся здесь после отправки учащимися.')}`, 'reviews');
}
async function adminAudit() {const data=await api('/admin/audit');return adminShell(`<div class="eyebrow">Прозрачность изменений</div><h1>Журнал действий</h1><div class="table-wrap"><table><thead><tr><th>Дата</th><th>Исполнитель</th><th>Действие</th><th>Объект</th></tr></thead><tbody>${data.map(a=>`<tr><td>${date(a.created_at)}</td><td>${esc(a.name)}</td><td>${esc(a.action)}</td><td>${esc(a.object)}</td></tr>`).join('')}</tbody></table></div>${!data.length?empty('Журнал пока пуст','Здесь сохраняются административные операции.'):''}`,'audit');}

function editInput(label,path,value,type='text',extra='') {return `<div class="field"><label for="e-${path}">${label}</label><input id="e-${path}" data-bind="${path}" type="${type}" value="${esc(value)}" ${extra}></div>`;}
function editArea(label,path,value,extra='') {return `<div class="field"><label for="e-${path}">${label}</label><textarea id="e-${path}" data-bind="${path}" ${extra}>${esc(value)}</textarea></div>`;}
function editorContent() {
  const c=state.editor;
  return adminShell(`<div class="breadcrumbs"><a href="/admin/courses">Курсы</a> / Редактор</div><div class="section-heading"><div><h1>${esc(c.title)}</h1>${badge(c.status)}</div><button class="secondary" data-action="preview">Предпросмотр ↗</button></div>${c.locked_structure?'<div class="notice">На курс уже записались. Названия, содержание и порядок можно менять. Состав уроков и тесты зафиксированы: для их изменения создайте новый курс. Завершения и сертификаты сохраняются.</div>':''}<form id="editor-form" novalidate><section class="panel"><h2>Основная информация</h2><div class="editor-grid"><div class="wide">${editInput('Название курса','title',c.title,'text','required minlength="3" maxlength="150"')}</div><div class="wide">${editArea('Короткое описание для каталога','summary',c.summary,'maxlength="250"')}</div><div class="field"><label for="course-category">Направление</label><select id="course-category" data-bind="category_id"><option value="">Выберите направление</option>${state.categories.map(cat=>`<option value="${cat.id}" ${Number(c.category_id)===cat.id?'selected':''}>${esc(cat.name)}</option>`).join('')}</select></div><div class="field"><label for="course-level">Уровень</label><select id="course-level" data-bind="level">${['Начальный','Средний','Продвинутый'].map(v=>`<option ${c.level===v?'selected':''}>${v}</option>`).join('')}</select></div><div class="wide">${editArea('Полное описание','description',c.description,'maxlength="20000"')}${editArea('Результаты обучения — по одному на строку','outcomes',c.outcomes,'maxlength="5000"')}${editArea('Начальные знания','prerequisites',c.prerequisites,'maxlength="3000"')}</div><div class="field"><label for="cover-upload">Обложка курса</label><input type="file" id="cover-upload" accept="image/png,image/jpeg,image/webp" data-upload="cover"><p class="hint">JPG, PNG, WebP · до 8 МБ.</p>${c.cover?`<img src="${esc(c.cover)}" alt="Обложка" width="180">`:''}</div><div class="field"><label for="course-status">Статус публикации</label><select id="course-status" data-bind="status">${Object.entries(labels).filter(([key])=>!c.locked_structure||key!=='draft').map(([key,label])=>`<option value="${key}" ${c.status===key?'selected':''}>${label}</option>`).join('')}</select><p class="hint">Публикация требует описания, категории, результатов обучения и заполненной программы.</p><div id="publish-readiness" class="publication-readiness" aria-live="polite"></div></div><div class="field"><label for="course-progression">Порядок прохождения</label><select id="course-progression" data-bind="progression"><option value="sequential" ${c.progression!=="free"?"selected":""}>Последовательно — следующий урок после завершения</option><option value="free" ${c.progression==="free"?"selected":""}>Свободно — доступ ко всем урокам после записи</option></select><p class="hint">Можно изменить и после записи участников.</p></div></div></section><section class="panel"><h2>История публикаций</h2><p class="hint">Версии сохраняются при изменении опубликованной программы. Возврат версии сохраняет идентификаторы уроков и историю прохождения.</p>${c.versions?.length?`<div class="table-wrap"><table><thead><tr><th>Версия</th><th>Изменение</th><th>Дата</th><th></th></tr></thead><tbody>${c.versions.map(v=>`<tr><td>v${v.version}</td><td>${esc(v.change_note)}</td><td>${date(v.created_at)}</td><td><button type="button" class="secondary small" data-action="restore-version" data-version="${v.version}">Загрузить в редактор</button></td></tr>`).join('')}</tbody></table></div>`:empty('История начнётся с первой публикации','После сохранения опубликованного курса здесь появятся версии.')}</section><div class="section-heading"><h2>Программа курса</h2><button type="button" class="secondary small" data-action="add-module">+ Модуль</button></div>${c.modules.map((m,mi)=>`<div class="module-editor"><div class="module-header"><label class="sr-only" for="module-${mi}">Название модуля ${mi+1}</label><input id="module-${mi}" data-bind="modules.${mi}.title" value="${esc(m.title)}" required maxlength="150"><button type="button" class="secondary small" data-action="move-module" data-mi="${mi}" data-dir="-1" aria-label="Модуль выше">↑</button><button type="button" class="secondary small" data-action="move-module" data-mi="${mi}" data-dir="1" aria-label="Модуль ниже">↓</button><button type="button" class="danger small" data-action="remove-module" data-mi="${mi}">Удалить пустой модуль</button></div>${moduleSettings(m,mi,c)}${m.lessons.map((l,li)=>lessonEditor(l,mi,li,c.locked_structure)).join('')}${!c.locked_structure?`<button type="button" class="ghost small" data-action="add-lesson" data-mi="${mi}">+ Добавить урок</button>`:''}</div>`).join('')}${!c.modules.length?empty('Программа ещё не создана','Добавьте первый модуль и уроки.'):''}</section><section class="panel">${editInput('Примечание к версии','change_note',c.change_note||'','text','maxlength="250" placeholder="Например, обновлена практика модуля 2"')}</section><div class="editor-bar"><span>${state.dirty?'Есть несохранённые изменения':'Все изменения сохранены'}</span><p class="form-error" role="alert"></p><div class="actions"><button type="button" class="secondary" data-action="preview">Предпросмотр</button><button type="submit">Сохранить курс ✓</button></div></div></form>`,'courses');
}

function publicationIssues() {
  const c=state.editor;if(!c)return [];
  const issues=[];const add=(path,label,section='')=>issues.push({path,label,section});
  if(String(c.title||'').trim().length<3)add('title','Введите название курса (не менее 3 символов).');
  if(!String(c.summary||'').trim())add('summary','Добавьте короткое описание для каталога.');
  if(!c.category_id)add('category_id','Выберите направление курса.');
  if(!String(c.description||'').trim())add('description','Заполните полное описание курса.');
  if(!String(c.outcomes||'').trim())add('outcomes','Укажите результаты обучения.');
  if(!Array.isArray(c.modules)||!c.modules.length)add('modules','Добавьте хотя бы один модуль.');
  (c.modules||[]).forEach((m,mi)=>{
    if(String(m.title||'').trim().length<2)add(`modules.${mi}.title`,`Заполните название модуля «${m.title||`Модуль ${mi+1}`}».`);
    if(!m.lessons?.length)add(`modules.${mi}.lessons`,`Добавьте урок в модуль «${m.title||`Модуль ${mi+1}`}».`);
    (m.lessons||[]).forEach((l,li)=>{
      const path=`modules.${mi}.lessons.${li}`;const title=l.title||`Урок ${li+1}`;
      if(String(l.title||'').trim().length<2)add(`${path}.title`,`Заполните название урока «${title}».`,path);
      if(!String(l.content||'').trim()&&!String(l.video||'').trim()&&!l.quiz)add(`${path}.content`,`Добавьте материал, видео или тест в урок «${title}».`,path);
      if(l.video&&!/^https:\/\/(?:www\.youtube-nocookie\.com\/embed\/[\w-]+|rutube\.ru\/play\/embed\/[\w-]+\/?)$/.test(l.video))add(`${path}.video`,`Проверьте разрешённую ссылку на видео в уроке «${title}».`,path);
      if(l.quiz){
        if(!Array.isArray(l.quiz.questions)||!l.quiz.questions.length)add(`${path}.quiz.questions`,`Добавьте вопрос в тест урока «${title}».`,path);
        (l.quiz.questions||[]).forEach((q,qi)=>{
          if(String(q.text||'').trim().length<3)add(`${path}.quiz.questions.${qi}.text`,`Заполните текст вопроса ${qi+1} в уроке «${title}».`,path);
          const options=Array.isArray(q.options)?q.options:[];
          if(options.length<2||options.some(x=>!String(x||'').trim()))add(`${path}.quiz.questions.${qi}.options.0`,`Добавьте минимум два непустых варианта ответа для вопроса ${qi+1}.`,path);
          if(!Array.isArray(q.correct)||!q.correct.length||q.correct.some(i=>!Number.isInteger(i)||i<0||i>=options.length))add(`${path}.quiz.questions.${qi}.correct`,`Отметьте правильный ответ в вопросе ${qi+1}.`,path);
        });
      }
    });
  });
  return issues;
}
function updatePublicationReadiness() {
  const host=$('#publish-readiness');if(!host||!state.editor)return;
  $$('.validation-missing').forEach(el=>el.classList.remove('validation-missing'));
  $$('[aria-invalid="true"]').forEach(el=>el.setAttribute('aria-invalid','false'));
  const issues=publicationIssues();
  if(state.publishAttempted)for(const issue of issues){
    const prefix=issue.path.replace(/\.(?:options|correct)(?:\.0)?$/,'');
    const field=$$('[data-bind]').find(el=>el.dataset.bind===issue.path)||$$('[data-bind]').find(el=>issue.path.endsWith('.options.0')&&el.dataset.bind.startsWith(prefix+'.options.'))||$$('[data-correct]').find(el=>issue.path.endsWith('.correct')&&el.dataset.correct===prefix);
    if(field){field.setAttribute('aria-invalid','true');const container=field.closest('.field')||field.closest('.option-editor')||field.closest('.question-editor')||field.closest('.module-editor')||field.closest('.lesson-editor')||field;container.classList.add('validation-missing');}
    else if(issue.section){const section=$$('[data-bind]').find(el=>el.dataset.bind===issue.section+'.content')?.closest('.lesson-editor');section?.classList.add('validation-missing');}
    else if(issue.path==='modules')$('[data-action="add-module"]')?.classList.add('validation-missing');
    else if(issue.path.startsWith('modules.')){$$('.module-editor')[Number(issue.path.split('.')[1])]?.classList.add('validation-missing');}
  }
  host.classList.toggle('ready',issues.length===0);
  host.innerHTML=issues.length?`<strong>До публикации осталось исправить: ${issues.length}</strong><ul>${issues.map(x=>`<li><button type="button" class="issue-link" data-action="focus-issue" data-path="${esc(x.path)}">${esc(x.label)}</button></li>`).join('')}</ul>`:'<strong>✓ Курс готов к публикации</strong><p>Все обязательные поля заполнены.</p>';
}

function moduleSettings(m,mi,c) {
  const earlier=c.modules.slice(0,mi).filter(x=>x.id);
  return `<div class="editor-grid module-settings">${editArea('Описание модуля',`modules.${mi}.description`,m.description||'','rows="3" maxlength="4000"')}${editArea('Результаты модуля — по одному на строку',`modules.${mi}.outcomes`,m.outcomes||'','rows="3" maxlength="2000"')}<div class="field"><label for="module-unlock-${mi}">Открытие модуля</label><select id="module-unlock-${mi}" data-bind="modules.${mi}.unlock_after_module_id"><option value="">По общему порядку курса</option>${earlier.map(x=>`<option value="${x.id}" ${Number(m.unlock_after_module_id)===x.id?'selected':''}>После завершения: ${esc(x.title)}</option>`).join('')}</select><p class="hint">Модуль откроется, когда участник завершит все уроки выбранного модуля.</p></div></div>`;
}
function lessonTransfer(mi,li) {
  const destinations=state.editor.modules.map((m,i)=>({m,i})).filter(x=>x.i!==mi);
  if(!destinations.length)return '';
  return `<div class="field"><label for="move-${mi}-${li}">Модуль урока</label><select id="move-${mi}-${li}" data-move-lesson="${mi}" data-li="${li}">${destinations.map(x=>`<option value="${x.i}">${esc(x.m.title)}</option>`).join('')}</select><p class="hint">Перенос сохраняет ID урока и его историю.</p></div>`;
}
function assignmentEditor(l,mi,li,locked) {
  const p=`modules.${mi}.lessons.${li}.assignment`;
  if(!l.assignment)return `<div class="section-heading"><h4>Практическое задание</h4>${!locked?`<button type="button" class="secondary small" data-action="toggle-assignment" data-mi="${mi}" data-li="${li}">+ Добавить задание</button>`:''}</div>`;
  const a=l.assignment;
  return `<div class="assignment-editor"><div class="section-heading"><h4>Практическое задание</h4>${!locked?`<button type="button" class="danger small" data-action="toggle-assignment" data-mi="${mi}" data-li="${li}">Удалить</button>`:''}</div>${editInput('Название задания',p+'.title',a.title,'text','required maxlength="150"')}${editArea('Условие и инструкции',p+'.instructions',a.instructions,'rows="5" required maxlength="10000"')}<div class="field"><label for="assignment-type-${mi}-${li}">Формат сдачи</label><select id="assignment-type-${mi}-${li}" data-bind="${p}.submission_type"><option value="text" ${a.submission_type==='text'?'selected':''}>Текстовый ответ</option><option value="url" ${a.submission_type==='url'?'selected':''}>Ссылка https://</option><option value="file" ${a.submission_type==='file'?'selected':''}>Файл PDF, TXT или CSV</option></select></div>${editInput('Максимум баллов',p+'.max_score',a.max_score,'number','min="1" max="1000"')}<label class="option"><input type="checkbox" data-bind="${p}.required" ${a.required?'checked':''}> Обязательное условие завершения урока</label><h5>Критерии оценки</h5>${a.rubric.map((r,ri)=>`<div class="editor-grid rubric-row">${editInput('Критерий',p+`.rubric.${ri}.title`,r.title,'text','required maxlength="150"')}${editInput('Баллы',p+`.rubric.${ri}.max_score`,r.max_score,'number','min="1" max="100"')}<button type="button" class="danger small" data-action="remove-rubric" data-mi="${mi}" data-li="${li}" data-ri="${ri}">Убрать</button></div>`).join('')}${!locked?`<button type="button" class="ghost small" data-action="add-rubric" data-mi="${mi}" data-li="${li}">+ Критерий</button>`:''}</div>`;
}
function lessonEditor(l,mi,li,locked) {
  const p=`modules.${mi}.lessons.${li}`;
  const data=`data-mi="${mi}" data-li="${li}"`;
  return `<details class="lesson-editor" open><summary>${li+1}. ${esc(l.title||'Новый урок')} ${l.quiz?'· тест':''}</summary><div class="editor-grid"><div class="wide">${editInput('Название урока',p+'.title',l.title,'text','required minlength="2" maxlength="150"')}</div>${editInput('Продолжительность, минуты',p+'.minutes',l.minutes,'number','min="1" max="600" required')}<div class="actions"><button type="button" class="secondary small" data-action="move-lesson" ${data} data-dir="-1" aria-label="Урок выше">↑</button><button type="button" class="secondary small" data-action="move-lesson" ${data} data-dir="1" aria-label="Урок ниже">↓</button>${!locked?`<button type="button" class="danger small" data-action="remove-lesson" ${data}>Удалить урок</button>`:''}</div>${lessonTransfer(mi,li)}<div class="wide">${editArea('Содержание урока (безопасный HTML)',p+'.content',l.content,'rows="7" maxlength="100000"')}<p class="hint">Поддерживаются p, h2, h3, strong, em, ul, ol, li, blockquote, pre, code и ссылки https. Опасные теги удаляются сервером.</p>${editInput('Видео — embed-ссылка YouTube (youtube-nocookie.com) или Rutube',p+'.video',l.video,'url')}<h4>Материалы</h4>${(l.materials||[]).map(m=>`<div class="actions"><a href="/api/media/${m.id}" target="_blank" rel="noopener">${esc(m.name)}</a><button type="button" class="danger small" data-action="remove-material" data-id="${m.id}">Удалить</button></div>`).join('')}${l.id?`<label class="hint">Загрузить изображение или PDF/TXT/CSV<input type="file" data-upload="material" data-lid="${l.id}" accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.csv"></label>`:'<p class="hint">Сохраните курс, чтобы загрузить материалы к новому уроку.</p>'}<div class="section-heading"><h4>Проверка знаний</h4>${!locked?`<button type="button" class="secondary small" data-action="toggle-quiz" ${data}>${l.quiz?'Удалить тест':'+ Добавить тест'}</button>`:''}</div>${l.quiz?`${editInput('Проходной балл, %',p+'.quiz.pass_score',l.quiz.pass_score,'number',`min="1" max="100" ${locked?'disabled':''}`)}${l.quiz.questions.map((q,qi)=>`<div class="question-editor">${editInput('Вопрос '+(qi+1),p+`.quiz.questions.${qi}.text`,q.text,'text',`required minlength="3" ${locked?'disabled':''}`)}<p class="hint">Отметьте правильные варианты. Несколько отметок — несколько правильных ответов.</p>${q.options.map((o,oi)=>`<div class="option-editor"><input type="checkbox" data-correct="${p}.quiz.questions.${qi}" value="${oi}" ${q.correct.includes(oi)?'checked':''} ${locked?'disabled':''} aria-label="Вариант ${oi+1} правильный"><input type="text" data-bind="${p}.quiz.questions.${qi}.options.${oi}" value="${esc(o)}" aria-label="Вариант ответа ${oi+1}" required ${locked?'disabled':''}>${!locked?`<button class="ghost small" type="button" data-action="remove-option" ${data} data-qi="${qi}" data-oi="${oi}" aria-label="Удалить вариант">×</button>`:''}</div>`).join('')}${!locked?`<button type="button" class="ghost small" data-action="add-option" ${data} data-qi="${qi}">+ Вариант</button>`:''}${editArea('Пояснение после проверки',p+`.quiz.questions.${qi}.explanation`,q.explanation,locked?'disabled':'')}${!locked?`<button class="danger small" type="button" data-action="remove-question" ${data} data-qi="${qi}">Удалить вопрос</button>`:''}</div>`).join('')}${!locked?`<button type="button" class="secondary small" data-action="add-question" ${data}>+ Вопрос</button>`:''}`:''}${assignmentEditor(l,mi,li,locked)}</div></div></details>`;
}
function pathValue(path) {return path.split('.').reduce((v,k)=>v[k],state.editor);}
function markDirty() {state.dirty=true;const label=$('.editor-bar>span');if(label)label.textContent='Есть несохранённые изменения';}
function rerenderEditor() {const y=scrollY;$('#main').innerHTML=editorContent();updatePublicationReadiness();window.scrollTo(0,y);}
const newQuestion=()=>({text:'Новый вопрос',options:['Первый вариант','Второй вариант'],correct:[0],explanation:''});
document.addEventListener('input',event=>{
  const el=event.target;if(el.dataset.bind && state.editor){const parts=el.dataset.bind.split('.');const last=parts.pop();const obj=parts.reduce((v,k)=>v[k],state.editor);obj[last]=el.type==='number'?Number(el.value):el.type==='checkbox'?el.checked:el.value;markDirty();updatePublicationReadiness();}
});
document.addEventListener('change',async event=>{
  const el=event.target;
  try {
    if(el.dataset.moveLesson!==undefined){const from=Number(el.dataset.moveLesson),to=Number(el.value),lesson=state.editor.modules[from].lessons.splice(Number(el.dataset.li),1)[0];state.editor.modules[to].lessons.push(lesson);markDirty();rerenderEditor();return;}
    if(el.dataset.bind && el.tagName==='SELECT'){const parts=el.dataset.bind.split('.');const last=parts.pop();parts.reduce((v,k)=>v[k],state.editor)[last]=el.value;markDirty();updatePublicationReadiness();}
    if(el.dataset.correct){const q=pathValue(el.dataset.correct);const index=Number(el.value);q.correct=el.checked?[...new Set([...q.correct,index])]:q.correct.filter(i=>i!==index);markDirty();updatePublicationReadiness();}
    if(el.closest('#catalog-form') && el.tagName==='SELECT')$('#catalog-form').requestSubmit();
    if(el.id==='analytics-period')navigate(location.pathname+'?days='+el.value);
    if(el.dataset.upload && el.files[0]) {
      const form=new FormData();form.append('file',el.files[0]);form.append('purpose',el.dataset.upload);if(el.dataset.lid)form.append('lesson_id',el.dataset.lid);
      el.disabled=true;const d=await api('/upload','POST',form);
      if(el.dataset.upload==='assignment'){state.assignmentUpload=d.id;const label=$('#assignment-upload-name');if(label)label.textContent=el.files[0].name;toast('Файл загружен. Отправьте работу, чтобы сохранить её.');}
      else if(el.dataset.upload==='avatar'){$('#profile-form [name=avatar]').value=d.url;toast('Аватар загружен. Сохраните профиль.');}
      else if(el.dataset.upload==='cover'){state.editor.cover=d.url;markDirty();rerenderEditor();toast('Обложка загружена. Сохраните курс.');}
      else{const l=state.editor.modules.flatMap(m=>m.lessons).find(l=>l.id===Number(el.dataset.lid));l.materials.push({id:d.id,name:el.files[0].name,kind:/\.(png|jpg|jpeg|webp)$/i.test(el.files[0].name)?'image':'file'});rerenderEditor();toast('Материал добавлен.');}
      el.disabled=false;
    }
  }catch(error){el.disabled=false;toast(error.message);}
});
document.addEventListener('submit',async event=>{
  const form=event.target;if(form.closest('#confirm'))return;
  event.preventDefault();const values=Object.fromEntries(new FormData(form));const button=$('button[type=submit],button:not([type])',form);const errorEl=$('.form-error',form);if(errorEl)errorEl.textContent='';if(button)button.disabled=true;
  try {
    switch(form.id) {
      case 'preview-quiz-form':{
        const index=Number(form.dataset.index);const lesson=previewItems()[index]?.lesson;if(!lesson?.quiz||!state.preview)return;
        const feedback=lesson.quiz.questions.map((question,qi)=>{
          const answer=$$(`[name="preview-q-${qi}"]:checked`,form).map(input=>Number(input.value));
          const correct=answer.length===question.correct.length&&answer.every(value=>question.correct.includes(value));
          return {text:question.text,correct,explanation:question.explanation||'',answer:question.correct.map(value=>question.options[value])};
        });
        const score=Math.round(feedback.filter(item=>item.correct).length/Math.max(1,feedback.length)*100);
        const result={score,passed:score>=(Number(lesson.quiz.pass_score)||70),feedback};
        state.preview.results[index]=result;
        if(result.passed&&previewCanComplete(index)&&!state.preview.completed.includes(index))state.preview.completed.push(index);
        renderStudentPreview();toast(result.passed?'Тест пройден в предпросмотре.':'Посмотрите пояснения и попробуйте ещё раз.');break;
      }
      case 'catalog-form':{const params=new URLSearchParams(values);for(const [k,v] of [...params])if(!v)params.delete(k);await navigate('/courses?'+params);break;}
      case 'login-form': case 'register-form':{const d=await api(form.id==='login-form'?'/login':'/register','POST',values);state.user=d.user;const target=sessionStorage.getItem('returnTo')||'/dashboard';sessionStorage.removeItem('returnTo');await navigate(target);toast('Добро пожаловать!');break;}
      case 'profile-form':await api('/profile','PUT',values);state.user=(await api('/session')).user;header();toast('Профиль обновлён.');break;
      case 'password-form':await api('/password','POST',values);form.reset();toast('Пароль изменён. Другие сессии завершены.');break;
      case 'note-form':await api(`/lessons/${form.dataset.id}/note`,'PUT',{text:values.note});toast('Заметка сохранена.');break;
      case 'review-form':await api(`/courses/${form.dataset.id}/review`,'POST',values);toast('Спасибо за отзыв!');await render();break;
      case 'quiz-form':{const answers={};for(const q of state.lesson.quiz.questions)answers[q.id]=$$(`input[name="q-${q.id}"]:checked`,form).map(el=>Number(el.value));const result=await api(`/lessons/${form.dataset.id}/attempt`,'POST',{answers});await render();$('#quiz-result').innerHTML=feedbackBlock(result);$('#quiz-result').scrollIntoView({behavior:'smooth',block:'center'});toast(result.passed?'Тест пройден. Прогресс сохранён.':'Попытка сохранена. Изучите пояснения и попробуйте снова.');break;}
      case 'users-form':await navigate('/admin/users?'+new URLSearchParams(values));break;
      case 'goal-form':await api('/learning-goal','PUT',{weekly_minutes:Number(values.weekly_minutes),reminder_time:values.reminder_time,reminder_enabled:form.elements.reminder_enabled.checked});toast('Цель и напоминания сохранены.');await render();break;
      case 'assignment-form':await api(`/lessons/${form.dataset.id}/assignment`,'POST',{body:values.body,attachment_id:state.assignmentUpload||null});state.assignmentUpload=null;await render();toast('Работа отправлена на проверку.');break;
      case 'review-assignment-form':{const rubric_scores=Object.fromEntries($$('[data-rubric-score]',form).map(el=>[el.dataset.rubricScore,Number(el.value)]));await api(`/admin/assignments/submissions/${form.dataset.id}/review`,'POST',{status:values.status,feedback:values.feedback,score:Number(values.score),rubric_scores});await render();toast('Результат проверки сохранён.');break;}
      case 'category-form':await api('/admin/categories','POST',values);state.categories=await api('/categories');form.reset();toast('Направление добавлено.');break;
      case 'editor-form':if(state.editor.status==='published'){state.publishAttempted=true;updatePublicationReadiness();const issues=publicationIssues();if(issues.length){const err=$('.form-error',form);if(err)err.textContent='Курс пока нельзя опубликовать: заполните отмеченные поля.';const first=$$('[aria-invalid="true"]',form)[0]||$('.validation-missing',form);first?.scrollIntoView({behavior:'smooth',block:'center'});first?.focus?.();return;}}state.editor=await api('/admin/courses/'+state.editor.id,'PUT',state.editor);state.dirty=false;rerenderEditor();toast('Курс сохранён.');break;
    }
  }catch(error){if(errorEl)errorEl.textContent=error.message;else toast(error.message);}finally{if(button)button.disabled=false;}
});
document.addEventListener('click',async event=>{
  const el=event.target.closest('[data-action]');if(!el)return;event.preventDefault();const action=el.dataset.action;const id=el.dataset.id;
  if(el.disabled)return;el.disabled=true;
  try {
    if(action==='focus-issue'){const path=el.dataset.path;const field=$$('[data-bind]').find(item=>item.dataset.bind===path)||$$('[data-correct]').find(item=>path.endsWith('.correct')&&item.dataset.correct===path.slice(0,-8));const moduleIndex=Number(path.split('.')[1]);const moduleBox=$$('.module-editor')[moduleIndex];const section=field?.closest('.lesson-editor')||field?.closest('.module-editor')||moduleBox||$('.module-editor');const fallback=path==='modules'?$('[data-action="add-module"]'):path.endsWith('.lessons')?$$('.module-editor')[moduleIndex]?.querySelector('[data-action="add-lesson"]'):null;const target=field||fallback||section;target?.scrollIntoView({behavior:'smooth',block:'center'});target?.focus?.();return;}
    if(action==='restore-version'){if(!(await confirmAction(`Загрузить версию ${el.dataset.version} в редактор? Текущие изменения вступят в силу только после сохранения.`)))return;const history=state.editor.versions;const locked=state.editor.locked_structure;const snap=await api(`/admin/courses/${state.editor.id}/versions/${el.dataset.version}`);state.editor=snap;state.editor.versions=history;state.editor.locked_structure=locked;state.editor.change_note=`Восстановление версии ${el.dataset.version}`;state.dirty=true;rerenderEditor();toast('Версия загружена. Сохраните курс, чтобы опубликовать изменения.');return;}
    if(action==='logout'){await api('/logout','POST',{});state.user=null;await api('/session');await navigate('/');return;}
    if(action==='scroll-catalog'){$('#catalog').scrollIntoView({behavior:'smooth'});return;}
    if(action==='reset-filter'){await navigate('/courses?clear_filters=1');return;}
    if(action==='page'){const p=new URLSearchParams(location.search);p.set('page',el.dataset.page);await navigate('/courses?'+p);return;}
    if(action==='favorite'||action==='enroll'){
      if(!state.user){sessionStorage.setItem('returnTo',location.pathname+location.search);await navigate('/auth');toast('Войдите или создайте аккаунт, чтобы продолжить.');return;}
      if(action==='favorite'){await api(`/courses/${id}/favorite`,'POST',{enabled:el.dataset.enabled==='true'});await render();toast('Избранное обновлено.');}
      else{const c=await api(`/courses/${id}/enroll`,'POST',{});await navigate('/learn/'+c.resume);toast('Вы записались на курс!');}return;
    }
    if(action==='complete'){await api(`/lessons/${id}/complete`,'POST',{});await render();toast('Урок завершён. Прогресс сохранён.');return;}
    if(action==='read-notifications'){await api('/notifications/read','POST',{});await render();toast('Уведомления прочитаны.');return;}
    if(action==='new-course'){const d=await api('/admin/courses','POST',{title:'Новый курс'});await navigate('/admin/courses/'+d.id);return;}
    if(action==='archive'){if(await confirmAction('Архивировать курс? Он исчезнет из каталога, но останется доступен записанным пользователям.')){await api(`/admin/courses/${id}/archive`,'POST',{});await render();toast('Курс перенесён в архив.');}return;}
    if(action==='block'){const blocked=el.dataset.blocked==='true';if(await confirmAction(blocked?'Заблокировать аккаунт и завершить все его сессии?':'Разблокировать аккаунт?')){await api(`/admin/users/${id}/block`,'POST',{blocked});await render();toast('Статус аккаунта изменён.');}return;}
    if(action==='remove-material'){if(await confirmAction('Удалить учебный материал из урока?')){await api('/admin/materials/'+id,'DELETE');for(const l of state.editor.modules.flatMap(m=>m.lessons))l.materials=l.materials.filter(m=>m.id!==Number(id));rerenderEditor();}return;}
    if(action==='preview'){
      if(!state.editor)return;
      state.preview={course:state.editor,current:0,completed:[],results:{},approvedAssignments:[]};
      renderStudentPreview();window.scrollTo(0,0);return;
    }
    if(action==='preview-select'){
      const index=Number(el.dataset.index);
      if(!previewIsUnlocked(index))return;
      state.preview.current=index;renderStudentPreview();window.scrollTo(0,0);return;
    }
    if(action==='preview-approve-assignment'){
      const index=Number(el.dataset.index);if(!state.preview||!previewIsUnlocked(index))return;
      if(!state.preview.approvedAssignments.includes(index))state.preview.approvedAssignments.push(index);
      if(previewCanComplete(index)&&!state.preview.completed.includes(index))state.preview.completed.push(index);
      const next=index+1;state.preview.current=next<previewItems().length&&previewIsUnlocked(next)?next:index;
      renderStudentPreview();window.scrollTo(0,0);return;
    }
    if(action==='preview-complete'){
      const index=Number(el.dataset.index);
      if(!state.preview||!previewIsUnlocked(index)||!previewCanComplete(index))return;
      if(!state.preview.completed.includes(index))state.preview.completed.push(index);
      const next=index+1;
      state.preview.current=next<previewItems().length&&previewIsUnlocked(next)?next:index;
      renderStudentPreview();window.scrollTo(0,0);return;
    }
    if(action==='reader-setting'){
      const setting=el.dataset.setting,value=el.dataset.value;
      if(setting==='size'&&['small','normal','large'].includes(value))state.reader.size=value;
      if(setting==='width'&&['narrow','normal','wide'].includes(value))state.reader.width=value;
      try{localStorage.setItem('vector-reading',JSON.stringify(state.reader));}catch{}
      const article=$('.lesson-content');if(article){article.dataset.readerSize=state.reader.size;article.dataset.readerWidth=state.reader.width;}
      $$('.reader-choice').forEach(button=>{const selected=state.reader[button.dataset.setting]===button.dataset.value;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));});
      const status=$('.reader-status');if(status)status.textContent=`Текст ${state.reader.size==='small'?'15':state.reader.size==='large'?'22':'18'} px · ${{narrow:'узкая',normal:'обычная',wide:'широкая'}[state.reader.width]} строка`;
      return;
    }
    if(action==='back-editor'){document.body.classList.remove('student-preview');rerenderEditor();return;}
    if(!state.editor)return;
    const c=state.editor;const mi=Number(el.dataset.mi),li=Number(el.dataset.li),qi=Number(el.dataset.qi),oi=Number(el.dataset.oi);const m=c.modules[mi];const l=m?.lessons[li];const q=l?.quiz?.questions[qi];
    if(['remove-module','remove-lesson','toggle-quiz','remove-question'].includes(action)&&!(await confirmAction('Изменить программу? Изменения вступят в силу после сохранения курса.')))return;
    switch(action){
      case 'add-module':c.modules.push({title:'Новый модуль',lessons:[]});break;
      case 'remove-module':c.modules.splice(mi,1);break;
      case 'move-module':{const target=mi+Number(el.dataset.dir);if(target>=0&&target<c.modules.length)[c.modules[mi],c.modules[target]]=[c.modules[target],c.modules[mi]];break;}
      case 'add-lesson':m.lessons.push({title:'Новый урок',content:'',minutes:15,video:'',quiz:null,assignment:null,materials:[]});break;
      case 'toggle-assignment':l.assignment=l.assignment?null:{title:'Практическое задание',instructions:'Опишите шаги работы, ожидаемый результат и формат ответа.',submission_type:'text',max_score:100,required:true,rubric:[{id:crypto.randomUUID(),title:'Решение соответствует условию',max_score:60},{id:crypto.randomUUID(),title:'Обоснование и проверка результата',max_score:40}]};break;
      case 'add-rubric':l.assignment.rubric.push({id:crypto.randomUUID(),title:'Новый критерий',max_score:10});break;
      case 'remove-rubric':l.assignment.rubric.splice(Number(el.dataset.ri),1);break;
      case 'remove-lesson':m.lessons.splice(li,1);break;
      case 'move-lesson':{const target=li+Number(el.dataset.dir);if(target>=0&&target<m.lessons.length)[m.lessons[li],m.lessons[target]]=[m.lessons[target],m.lessons[li]];break;}
      case 'toggle-quiz':l.quiz=l.quiz?null:{pass_score:70,questions:[newQuestion()]};break;
      case 'add-question':l.quiz.questions.push(newQuestion());break;
      case 'remove-question':l.quiz.questions.splice(qi,1);break;
      case 'add-option':q.options.push('Новый вариант');break;
      case 'remove-option':q.options.splice(oi,1);q.correct=q.correct.filter(i=>i!==oi).map(i=>i>oi?i-1:i);break;
      default:return;
    }
    markDirty();rerenderEditor();
  }catch(error){toast(error.message);}finally{el.disabled=false;}
});
async function render() {
  const token=++state.route;header();$('#main').innerHTML='<div class="loading" role="status">Загружаем…</div>';
  const path=location.pathname;let html='';
  try{
    if((path.startsWith('/admin')||path.startsWith('/learn')||['/dashboard','/profile'].includes(path))&&!state.user){sessionStorage.setItem('returnTo',path);history.replaceState({},'','/auth');html=authPage();}
    else if(path.startsWith('/admin')&&state.user.role!=='admin')html=empty('Доступ ограничен','Управление доступно только администратору. <a href="/dashboard">В кабинет</a>');
    else if(path==='/'||path==='/courses')html=await catalog();
    else if(/^\/courses\/\d+$/.test(path))html=await coursePage(path.split('/')[2]);
    else if(path==='/auth')html=authPage();
    else if(path==='/register')html=authPage(true);
    else if(path==='/privacy')html=privacyPage();
    else if(path==='/dashboard')html=await dashboardPage();
    else if(path==='/profile')html=profilePage();
    else if(/^\/verify\/[0-9a-f-]{36}$/i.test(path))html=await verifyCertificate(path.split('/')[2]);
    else if(/^\/learn\/\d+$/.test(path))html=await lessonPage(path.split('/')[2]);
    else if(path==='/admin'||path==='/admin/analytics')html=await adminOverview(path.endsWith('analytics'));
    else if(path==='/admin/courses')html=await adminCourses();
    else if(/^\/admin\/courses\/\d+$/.test(path)){state.editor=await api('/admin/courses/'+path.split('/')[3]);state.dirty=false;state.publishAttempted=false;html=editorContent();}
    else if(path==='/admin/users')html=await adminUsers();
    else if(path==='/admin/reviews')html=await adminReviews();
    else if(/^\/admin\/users\/\d+$/.test(path))html=await adminUser(path.split('/')[3]);
    else if(path==='/admin/audit')html=await adminAudit();
    else html=empty('Страница не найдена','<a href="/courses" class="button">Вернуться в каталог</a>');
  }catch(error){html=empty('Не удалось открыть страницу',`${esc(error.message)}<p class="spaced"><a href="/courses" class="button secondary">В каталог</a></p>`);if(error.status===401){state.user=null;html=empty('Войдите в аккаунт',`Сессия закончилась или аккаунт заблокирован. <a class="subtle-link" href="/auth">Перейти ко входу</a>`);}}
  if(token===state.route){$('#main').innerHTML=html;if(path.startsWith('/admin/courses/')&&state.editor)updatePublicationReadiness();header();document.title=($('#main h1')?.textContent||'Каталог курсов')+' — Вектор';}
}
(async()=>{try{const s=await api('/session');state.user=s.user;state.categories=await api('/categories');await render();}catch(error){$('#main').innerHTML=empty('Платформа пока недоступна',esc(error.message));}})();
