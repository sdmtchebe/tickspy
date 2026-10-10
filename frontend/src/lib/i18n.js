import { createContext, useContext, useEffect, useState } from "react";

export const LANGUAGES = [
  ["en", "English"],
  ["fr", "Français"],
  ["es", "Español"],
  ["de", "Deutsch"],
  ["pt", "Português"],
  ["it", "Italiano"],
  ["zh", "中文"],
  ["ja", "日本語"],
  ["ko", "한국어"],
  ["ru", "Русский"],
  ["ar", "العربية"],
  ["hi", "हिन्दी"],
];

const COPY = {
  en: {
    nav: ["Home", "The desk", "Features", "How it works", "Setup", "Contact"],
    openDesk: "Open desk",
    menu: "Menu",
    eyebrow: "Free market analysis desk",
    headlineA: "Every number,",
    headlineB: "explained",
    subheadline: "TickSPY draws the candles, runs 14 indicators, a volatility model, the news and the calendar for any US ticker, then says what each reading means in one plain sentence. No account required, and nothing held back behind a paywall.",
    ctaOpen: "Open the desk",
    ctaDemo: "See it in action",
    footnote: "Free mode replays a completed session. Current prices and 1-minute bars require your own Alpaca keys.",
    stats: ["no card, no account", "desk sections", "indicators scored", "timeframes"],
    language: "Language",
  },
  fr: {
    nav: ["Accueil", "Le bureau", "Fonctions", "Fonctionnement", "Configuration", "Contact"],
    openDesk: "Ouvrir le bureau",
    menu: "Menu",
    eyebrow: "Bureau gratuit d'analyse des marchés",
    headlineA: "Chaque chiffre,",
    headlineB: "expliqué",
    subheadline: "TickSPY trace les chandeliers, exécute 14 indicateurs, un modèle de volatilité, les nouvelles et le calendrier pour chaque titre américain, puis explique chaque lecture en une phrase simple. Aucun compte requis et rien n'est bloqué derrière un abonnement.",
    ctaOpen: "Ouvrir le bureau",
    ctaDemo: "Voir en action",
    footnote: "Le mode gratuit rejoue une séance terminée. Les cours actuels et les chandeliers d'une minute nécessitent vos propres clés Alpaca.",
    stats: ["aucune carte, aucun compte", "sections du bureau", "indicateurs évalués", "unités de temps"],
    language: "Langue",
  },
  es: {
    nav: ["Inicio", "La plataforma", "Funciones", "Cómo funciona", "Configuración", "Contacto"],
    openDesk: "Abrir plataforma",
    menu: "Menú",
    eyebrow: "Plataforma gratuita de análisis de mercado",
    headlineA: "Cada número,",
    headlineB: "explicado",
    subheadline: "TickSPY dibuja las velas, ejecuta 14 indicadores, un modelo de volatilidad, las noticias y el calendario para cualquier valor de EE. UU., y explica cada lectura en una frase sencilla. No requiere cuenta ni reserva funciones detrás de un pago.",
    ctaOpen: "Abrir la plataforma",
    ctaDemo: "Verlo en acción",
    footnote: "El modo gratuito reproduce una sesión completada. Los precios actuales y las velas de 1 minuto requieren tus propias claves de Alpaca.",
    stats: ["sin tarjeta ni cuenta", "secciones", "indicadores evaluados", "intervalos"],
    language: "Idioma",
  },
  de: {
    nav: ["Start", "Das Desk", "Funktionen", "So funktioniert es", "Einrichtung", "Kontakt"],
    openDesk: "Desk öffnen",
    menu: "Menü",
    eyebrow: "Kostenloses Marktanalyse-Desk",
    headlineA: "Jede Zahl,",
    headlineB: "erklärt",
    subheadline: "TickSPY zeichnet die Kerzen, berechnet 14 Indikatoren, ein Volatilitätsmodell, Nachrichten und den Kalender für jeden US-Titel und erklärt jede Messung in einem klaren Satz. Kein Konto erforderlich und nichts hinter einer Bezahlschranke.",
    ctaOpen: "Desk öffnen",
    ctaDemo: "In Aktion ansehen",
    footnote: "Der kostenlose Modus spielt eine abgeschlossene Sitzung ab. Aktuelle Kurse und 1-Minuten-Kerzen benötigen eigene Alpaca-Schlüssel.",
    stats: ["keine Karte, kein Konto", "Desk-Bereiche", "bewertete Indikatoren", "Zeiträume"],
    language: "Sprache",
  },
  pt: {
    nav: ["Início", "A mesa", "Recursos", "Como funciona", "Configuração", "Contato"],
    openDesk: "Abrir mesa",
    menu: "Menu",
    eyebrow: "Mesa gratuita de análise de mercado",
    headlineA: "Cada número,",
    headlineB: "explicado",
    subheadline: "A TickSPY desenha os candles, executa 14 indicadores, um modelo de volatilidade, notícias e calendário para qualquer ativo dos EUA e explica cada leitura em uma frase simples. Sem conta e sem recursos escondidos atrás de pagamento.",
    ctaOpen: "Abrir a mesa",
    ctaDemo: "Ver em ação",
    footnote: "O modo gratuito reproduz uma sessão concluída. Preços atuais e candles de 1 minuto exigem suas próprias chaves Alpaca.",
    stats: ["sem cartão, sem conta", "seções da mesa", "indicadores avaliados", "intervalos"],
    language: "Idioma",
  },
  it: {
    nav: ["Home", "La desk", "Funzioni", "Come funziona", "Configurazione", "Contatti"],
    openDesk: "Apri la desk",
    menu: "Menu",
    eyebrow: "Desk gratuita di analisi dei mercati",
    headlineA: "Ogni numero,",
    headlineB: "spiegato",
    subheadline: "TickSPY disegna le candele, esegue 14 indicatori, un modello di volatilità, notizie e calendario per qualsiasi titolo USA e spiega ogni lettura in una frase semplice. Nessun account richiesto e nulla è bloccato dietro un pagamento.",
    ctaOpen: "Apri la desk",
    ctaDemo: "Guardala in azione",
    footnote: "La modalità gratuita riproduce una sessione completata. Prezzi attuali e candele a 1 minuto richiedono le tue chiavi Alpaca.",
    stats: ["nessuna carta, nessun account", "sezioni della desk", "indicatori valutati", "intervalli"],
    language: "Lingua",
  },
  zh: {
    nav: ["首页", "分析台", "功能", "工作方式", "设置", "联系"],
    openDesk: "打开分析台",
    menu: "菜单",
    eyebrow: "免费的市场分析台",
    headlineA: "每一个数字，",
    headlineB: "都有解释",
    subheadline: "TickSPY 为任意美国股票绘制蜡烛图，运行 14 个指标、波动率模型、新闻和日历，然后用一句简单的话说明每个读数的含义。无需账户，也没有隐藏在付费墙后的功能。",
    ctaOpen: "打开分析台",
    ctaDemo: "查看演示",
    footnote: "免费模式回放已完成的交易时段。当前价格和 1 分钟蜡烛图需要你自己的 Alpaca 密钥。",
    stats: ["无需银行卡和账户", "分析台模块", "已评分指标", "时间周期"],
    language: "语言",
  },
  ja: {
    nav: ["ホーム", "デスク", "機能", "使い方", "設定", "お問い合わせ"],
    openDesk: "デスクを開く",
    menu: "メニュー",
    eyebrow: "無料の市場分析デスク",
    headlineA: "すべての数字を、",
    headlineB: "わかりやすく",
    subheadline: "TickSPY は米国株のローソク足を描画し、14 個の指標、ボラティリティモデル、ニュース、カレンダーを実行して、それぞれの読み方を一文で説明します。アカウント不要で、有料機能もありません。",
    ctaOpen: "デスクを開く",
    ctaDemo: "動きを見る",
    footnote: "無料モードでは完了済みセッションを再生します。現在価格と 1 分足にはご自身の Alpaca キーが必要です。",
    stats: ["カード・アカウント不要", "デスクのセクション", "評価指標", "時間足"],
    language: "言語",
  },
  ko: {
    nav: ["홈", "분석 데스크", "기능", "작동 방식", "설정", "문의"],
    openDesk: "데스크 열기",
    menu: "메뉴",
    eyebrow: "무료 시장 분석 데스크",
    headlineA: "모든 숫자를,",
    headlineB: "설명합니다",
    subheadline: "TickSPY는 미국 주식의 캔들, 14개 지표, 변동성 모델, 뉴스와 캘린더를 실행하고 각 수치의 의미를 한 문장으로 설명합니다. 계정이 필요 없으며 유료로 잠긴 기능도 없습니다.",
    ctaOpen: "데스크 열기",
    ctaDemo: "실제로 보기",
    footnote: "무료 모드는 완료된 세션을 재생합니다. 현재 가격과 1분봉에는 본인의 Alpaca 키가 필요합니다.",
    stats: ["카드·계정 불필요", "데스크 섹션", "평가 지표", "시간 단위"],
    language: "언어",
  },
  ru: {
    nav: ["Главная", "Терминал", "Возможности", "Как это работает", "Настройка", "Контакты"],
    openDesk: "Открыть терминал",
    menu: "Меню",
    eyebrow: "Бесплатный терминал анализа рынка",
    headlineA: "Каждое число,",
    headlineB: "с объяснением",
    subheadline: "TickSPY строит свечи, запускает 14 индикаторов, модель волатильности, новости и календарь для любой акции США, а затем объясняет каждое значение одним понятным предложением. Аккаунт не нужен, платных скрытых функций нет.",
    ctaOpen: "Открыть терминал",
    ctaDemo: "Посмотреть работу",
    footnote: "Бесплатный режим воспроизводит завершённую сессию. Для текущих цен и свечей в 1 минуту нужны собственные ключи Alpaca.",
    stats: ["без карты и аккаунта", "разделы терминала", "оценённые индикаторы", "интервалы"],
    language: "Язык",
  },
  ar: {
    nav: ["الرئيسية", "المنصة", "الميزات", "كيف تعمل", "الإعداد", "اتصل بنا"],
    openDesk: "فتح المنصة",
    menu: "القائمة",
    eyebrow: "منصة مجانية لتحليل الأسواق",
    headlineA: "كل رقم،",
    headlineB: "مع شرح",
    subheadline: "ترسم TickSPY الشموع وتشغّل 14 مؤشراً ونموذج تقلبات والأخبار والتقويم لأي سهم أمريكي، ثم تشرح معنى كل قراءة في جملة واضحة. لا حاجة إلى حساب ولا توجد ميزات مخفية خلف الدفع.",
    ctaOpen: "فتح المنصة",
    ctaDemo: "شاهدها أثناء العمل",
    footnote: "يعيد الوضع المجاني تشغيل جلسة مكتملة. تتطلب الأسعار الحالية والشموع ذات الدقيقة الواحدة مفاتيح Alpaca الخاصة بك.",
    stats: ["لا بطاقة ولا حساب", "أقسام المنصة", "المؤشرات المقيمة", "الأطر الزمنية"],
    language: "اللغة",
  },
  hi: {
    nav: ["होम", "डेस्क", "सुविधाएँ", "यह कैसे काम करता है", "सेटअप", "संपर्क"],
    openDesk: "डेस्क खोलें",
    menu: "मेन्यू",
    eyebrow: "मुफ़्त बाज़ार विश्लेषण डेस्क",
    headlineA: "हर संख्या,",
    headlineB: "समझाई गई",
    subheadline: "TickSPY किसी भी अमेरिकी शेयर के कैंडल, 14 संकेतक, अस्थिरता मॉडल, समाचार और कैलेंडर चलाता है, फिर हर रीडिंग का अर्थ एक सरल वाक्य में बताता है। खाते की ज़रूरत नहीं और कोई सुविधा भुगतान के पीछे छिपी नहीं है।",
    ctaOpen: "डेस्क खोलें",
    ctaDemo: "काम करते देखें",
    footnote: "मुफ़्त मोड एक पूरी हो चुकी सत्र का पुनः प्रदर्शन करता है। मौजूदा कीमतों और 1-मिनट कैंडल के लिए आपकी अपनी Alpaca कुंजियाँ चाहिए।",
    stats: ["कार्ड या खाता नहीं", "डेस्क सेक्शन", "मूल्यांकित संकेतक", "समय-सीमा"],
    language: "भाषा",
  },
};

const LocaleContext = createContext(null);
const STORAGE_KEY = "tickspy-locale";

const initialLocale = () => {
  if (typeof window === "undefined") return "en";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (COPY[stored]) return stored;
  } catch (_) {
    // Continue with the browser preference when storage is unavailable.
  }
  const browser = (navigator.language || "en").slice(0, 2).toLowerCase();
  return COPY[browser] ? browser : "en";
};

export const LocaleProvider = ({ children }) => {
  const [locale, setLocale] = useState(initialLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
    try { window.localStorage.setItem(STORAGE_KEY, locale); } catch (_) {}
  }, [locale]);

  const value = { locale, setLocale, copy: COPY[locale] || COPY.en };
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
};

export const useLocale = () => {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useLocale must be used inside LocaleProvider");
  return context;
};
