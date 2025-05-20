/**
 * Коллектор поисковых результатов Яндекса
 * Выполняет поисковые запросы и сохраняет результаты в JSON и CSV файлы
 */

// Импорт необходимых модулей
const fs = require('fs-extra');
const path = require('path');
const puppeteer = require('puppeteer');
const moment = require('moment');
const { setTimeout } = require('timers/promises');
const searchQueryWithPagination = require('./searchQueryWithPagination');
require('dotenv').config();

// Константы
const BASE_URL = 'https://ya.ru/search/?text=';
const RESULTS_DIR = path.join(__dirname, '..', 'data', 'results');
const QUERIES_FILE = path.join(__dirname, '..', 'data', 'queries.json');
const DELAYS = {
  MIN: 3000,
  MAX: 7000
};
const MAX_PAGES_PER_QUERY = 10; // Максимальное количество страниц для сбора (примерно 100 результатов)

// Поисковые запросы
const DEFAULT_QUERIES = [
  'кредит для ИП',
  'кредит для ООО',
  'кредитование малого бизнеса',
  'кредитование среднего бизнеса',
  'кредитование крупного бизнеса',
  'кредитование бизнеса',
  'займ для ООО',
  'займ для ИП',
  'займы для бизнеса',
  'бизнес кредит онлайн',
  'кредит для бизнеса без залога',
  'кредит для ИП без отказа',
  'кредит для ИП под залог',
  'срочный кредит ИП',
  'срочный кредит ООО',
  'получить кредит для бизнеса',
  'получить займ для бизнеса',
  'банки дающие кредит для ИП',
  'государственные кредиты для бизнеса',
  'кредит на развитие бизнеса',
  'коммерческий займ для ООО',
  'коммерческий займ для ИП',
  'частный займ для бизнеса',
  'финансирование малого бизнеса',
  'кредит на оборотные средства',
  'кредит на закупку товара',
  'кредит под контракт',
  'финансирование контракта',
  'финансирование гос контракта',
  'финансирование тендера',
  'кредиты для селлеров',
  'кредиты для маркетплейсов'
];

// Список исключаемых доменов (банки и агрегаторы, кроме URL с релевантными ключевыми словами)
const EXCLUDED_DOMAINS = [
  'sberbank.ru', 'sberbank.com',
  'vtb.ru',
  'alfabank.ru',
  'tinkoff.ru',
  'gazprombank.ru',
  'raiffeisen.ru',
  'rsb.ru',
  'open.ru',
  'mtsbank.ru',
  'banki.ru',
  'sravni.ru',
  'bankiros.ru',
  'brobank.ru',
  'bankstoday.net',
  'vbr.ru',
  'cbr.ru',
  'finuslugi.ru',
  // Дополнительные домены для исключения
  'cbr.ru',
  'moex.com',
  'minfin.ru',
  'consultant.ru',
  'nalog.ru',
  'yandex.ru',
  'google.com',
  'youtube.com',
  'wikipedia.org'
];

// Ключевые слова, указывающие на релевантный URL о кредитовании бизнеса
const RELEVANT_KEYWORDS = [
  'kredit', 'credit', 'кредит', 
  'займ', 'zaim', 'zaym',
  'business', 'бизнес',
  'финансирование', 'финанс',
  'ip', 'ип', 'ооо', 'ooo',
  'малый', 'средний',
  'залог', 'без-залога',
  'развитие'
];

/**
 * Создает случайную задержку между запросами
 * @returns {Promise<void>} Промис с задержкой
 */
async function randomDelay() {
  const delay = Math.floor(Math.random() * (DELAYS.MAX - DELAYS.MIN + 1)) + DELAYS.MIN;
  console.log(`⏱️ Задержка ${delay / 1000} секунд...`);
  await setTimeout(delay);
}

/**
 * Проверяет, содержит ли URL релевантные ключевые слова о кредитовании бизнеса
 * @param {string} url - URL для проверки
 * @returns {boolean} true, если URL содержит релевантные ключевые слова
 */
function isRelevantURL(url) {
  const lowercaseURL = url.toLowerCase();
  return RELEVANT_KEYWORDS.some(keyword => lowercaseURL.includes(keyword));
}

/**
 * Парсит результаты поисковой выдачи Яндекса на одной странице
 * @param {Page} page - Объект страницы Puppeteer
 * @param {number} pageNum - Номер текущей страницы
 * @returns {Promise<Array>} Массив результатов поиска
 */
async function parseSearchResults(page, pageNum) {
  console.log(`🔍 Парсинг результатов поиска на странице ${pageNum + 1}...`);
  
  return await page.evaluate((excludedDomains, relevantKeywords, pageNum) => {
    // Функция для проверки релевантности URL
    function isURLRelevant(url) {
      const lowercaseURL = url.toLowerCase();
      return relevantKeywords.some(keyword => lowercaseURL.includes(keyword));
    }

    const results = [];
    const items = document.querySelectorAll('.serp-item');
    
    let organicPosition = 0;
    
    items.forEach((item) => {
      // Извлекаем данные из результатов поиска
      const titleElement = item.querySelector('.organic__url');
      if (!titleElement) return;
      
      const title = titleElement.textContent.trim();
      const url = titleElement.href;
      
      // Извлекаем домен из URL
      let domain = '';
      try {
        domain = new URL(url).hostname.replace('www.', '');
      } catch (e) {
        return; // Пропускаем результаты с некорректными URL
      }
      
      // Проверяем, является ли это рекламной ссылкой
      if (domain.includes('yabs.yandex.ru')) {
        return; // Пропускаем рекламные результаты
      }
      
      // Для банков и агрегаторов проверяем URL на релевантность
      const isExcludedDomain = excludedDomains.some(excluded => domain.includes(excluded));
      
      if (isExcludedDomain) {
        // Включаем только если URL содержит релевантные ключевые слова о кредитовании бизнеса
        if (!isURLRelevant(url)) {
          return; // Пропускаем нерелевантные URL
        }
      }
      
      // Извлекаем сниппет (описание результата)
      const snippetElement = item.querySelector('.organic__text');
      const snippet = snippetElement ? snippetElement.textContent.trim() : '';
      
      organicPosition++;
      
      // Добавляем результат в массив
      results.push({
        pagePosition: organicPosition,
        globalPosition: pageNum * 10 + organicPosition,
        title,
        url,
        domain,
        snippet
      });
    });
    
    return results;
  }, EXCLUDED_DOMAINS, RELEVANT_KEYWORDS, pageNum);
}

/**
 * Создает случайную задержку между запросами
 * @returns {Promise<void>} Промис с задержкой
 */
async function randomDelay() {
  const delay = Math.floor(Math.random() * (DELAYS.MAX - DELAYS.MIN + 1)) + DELAYS.MIN;
  console.log(`⏱️ Задержка ${delay / 1000} секунд...`);
  await setTimeout(delay);
}

/**
 * Парсит результаты поисковой выдачи Яндекса
 * @param {Page} page - Объект страницы Puppeteer
 * @param {number} pageNum - Номер текущей страницы (начиная с 0)
 * @returns {Array} Массив результатов поиска
 */
async function parseSearchResults(page, pageNum = 0) {
  console.log(`🔍 Парсинг результатов поиска на странице ${pageNum + 1}...`);
  
  return await page.evaluate((excludedDomains, relevantKeywords, pageNum) => {
    // Функция для проверки релевантности URL
    function isURLRelevant(url) {
      const lowercaseURL = url.toLowerCase();
      return relevantKeywords.some(keyword => lowercaseURL.includes(keyword));
    }
    
    const results = [];
    const items = document.querySelectorAll('.serp-item');
    
    let organicPosition = 0;
    
    items.forEach((item) => {
      // Извлекаем данные из результатов поиска
      const titleElement = item.querySelector('.organic__url');
      if (!titleElement) return;
      
      const title = titleElement.textContent.trim();
      const url = titleElement.href;
      
      // Извлекаем домен из URL
      let domain = '';
      try {
        domain = new URL(url).hostname.replace('www.', '');
      } catch (e) {
        return; // Пропускаем результаты с некорректными URL
      }
      
      // Для банков и агрегаторов проверяем URL на релевантность
      const isExcludedDomain = excludedDomains.some(excluded => domain.includes(excluded));
      
      if (isExcludedDomain) {
        // Включаем только если URL содержит релевантные ключевые слова о кредитовании бизнеса
        if (!isURLRelevant(url)) {
          return; // Пропускаем нерелевантные URL
        }
      }
      
      // Извлекаем сниппет (описание результата)
      const snippetElement = item.querySelector('.organic__text');
      const snippet = snippetElement ? snippetElement.textContent.trim() : '';
      
      organicPosition++;
      
      // Добавляем результат в массив
      results.push({
        pagePosition: organicPosition,
        globalPosition: pageNum * 10 + organicPosition,
        title,
        url,
        domain,
        snippet
      });
    });
    
    return results;
  }, EXCLUDED_DOMAINS, RELEVANT_KEYWORDS, pageNum);
}

/**
 * Выполняет поисковый запрос в Яндексе
 * @param {Browser} browser - Объект браузера Puppeteer
 * @param {string} query - Поисковый запрос
 * @returns {Array} Массив результатов поиска
 */
async function searchQuery(browser, query) {
  console.log(`\n🔍 Выполняем поиск: "${query}"`);
  
  // Открываем новую страницу
  const page = await browser.newPage();
  
  // Устанавливаем User-Agent как обычный браузер
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  // Настраиваем размер области просмотра
  await page.setViewport({ width: 1366, height: 768 });
  
  try {
    // Формируем URL запроса
    const encodedQuery = encodeURIComponent(query);
    const searchUrl = `${BASE_URL}${encodedQuery}`;
    
    // Переходим на страницу поиска
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    console.log('📄 Страница загружена');
    
    // Даем странице время для рендеринга
    await setTimeout(2000);
    
    // Проверяем, есть ли капча
    const hasCaptcha = await page.evaluate(() => {
      return document.body.textContent.includes('Подтвердите, что запросы отправляли вы, а не робот') ||
             document.querySelector('.captcha') !== null;
    });
    
    if (hasCaptcha) {
      console.log('⚠️ Обнаружена капча! Требуется ручное решение.');
      // Здесь можно добавить код для ручного решения капчи или использования сервисов распознавания
      await page.screenshot({ path: path.join(RESULTS_DIR, 'captcha.png') });
      console.log('📸 Сделан скриншот капчи: captcha.png');
      throw new Error('Запрос заблокирован капчей');
    }
    
    // Парсим результаты поиска
    const results = await parseSearchResults(page);
    console.log(`✅ Получено ${results.length} результатов поиска`);
    
    // Сохраняем результаты
    const timestamp = moment().format('YYYY-MM-DD_HH-mm');
    const searchResultsFile = path.join(RESULTS_DIR, `${query.replace(/\s+/g, '_')}_${timestamp}.json`);
    
    await fs.ensureDir(RESULTS_DIR);
    await fs.writeJson(searchResultsFile, results, { spaces: 2 });
    console.log(`💾 Результаты сохранены в ${searchResultsFile}`);
    
    return results;
  } catch (error) {
    console.error(`❌ Ошибка при поиске "${query}": ${error.message}`);
    return [];
  } finally {
    await page.close();
  }
}

/**
 * Загружает поисковые запросы из файла или использует стандартные
 * @returns {Array} Массив поисковых запросов
 */
async function loadQueries() {
  try {
    // Проверяем, существует ли файл с запросами
    if (await fs.pathExists(QUERIES_FILE)) {
      const queries = await fs.readJson(QUERIES_FILE);
      console.log(`📝 Загружено ${queries.length} запросов из файла`);
      return queries;
    }
  } catch (error) {
    console.error(`⚠️ Ошибка при загрузке запросов: ${error.message}`);
  }
  
  console.log(`📋 Используем стандартные запросы (${DEFAULT_QUERIES.length})`);
  return DEFAULT_QUERIES;
}

/**
 * Основная функция для запуска сбора данных
 */
async function main() {
  console.log('🚀 Запуск коллектора поисковых результатов Яндекса');
  
  // Проверяем, запускать в тестовом режиме для одного запроса
  const isTestMode = process.argv.includes('--test-one');
  if (isTestMode) {
    console.log('🚨 Запуск в ТЕСТОВОМ режиме для одного запроса!');
  }
  
  // Загружаем поисковые запросы
  let queries = await loadQueries();
  
  // В тестовом режиме берем только один запрос
  if (isTestMode) {
    queries = ['кредит для бизнеса без залога'];
    console.log(`🔍 Тестовый запрос: "${queries[0]}"`);
  }
  
  // Создаем директорию для результатов
  await fs.ensureDir(RESULTS_DIR);
  
  // Запускаем браузер
  console.log('🔎 Запускаем браузер...');
  
  // Настройки браузера
  // Всегда запускаем в видимом режиме, чтобы можно было решать капчу
  const headlessMode = false;
  
  // Запускаем браузер
  console.log('🕐 Запуск браузера Chrome...');
  
  const browser = await puppeteer.launch({
    headless: headlessMode,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-infobars',
      '--window-position=0,0',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled', // Скрываем признаки автоматизации
      '--disable-extensions',
      '--disable-dev-shm-usage', // Предотвращает ошибки памяти
      '--disable-accelerated-2d-canvas', // Снижает нагрузку на GPU
      '--no-first-run', // Пропускает первоначальные экраны
      '--no-zygote', // Повышает стабильность
      '--disable-web-security', // Позволяет более гибкую работу с CORS
      '--disable-features=IsolateOrigins,site-per-process', // Улучшает работу с iframe
      '--lang=ru-RU,ru' // Устанавливаем русский язык
    ],
    ignoreHTTPSErrors: true,
    defaultViewport: null,
    timeout: 90000, // Увеличиваем таймаут до 90 секунд
    protocolTimeout: 90000, // Таймаут протокола CDP
    waitForInitialPage: true, // Ждем инициализации первой страницы
    pipe: true // Улучшает стабильность соединения с браузером
  });
  
  console.log('✅ Браузер успешно запущен');
  
  try {
    // Обрабатываем каждый поисковый запрос
    let allResults = [];
    
    for (let i = 0; i < queries.length; i++) {
      const query = queries[i];
      console.log(`\n📈 Запрос ${i + 1}/${queries.length}: "${query}"`);
      
      // Выполняем поиск с пагинацией и получаем результаты
      const results = await searchQueryWithPagination(browser, query);
      allResults = allResults.concat(results);
      
      // Задержка между запросами (кроме последнего)
      if (i < queries.length - 1) {
        await randomDelay();
      }
    }
    
    // Сохраняем все результаты в один файл
    const timestamp = moment().format('YYYY-MM-DD_HH-mm');
    const allResultsFile = path.join(RESULTS_DIR, `all_results_${timestamp}.json`);
    await fs.writeJson(allResultsFile, allResults, { spaces: 2 });
    
    console.log(`\n✅ Готово! Всего собрано ${allResults.length} результатов.`);
    console.log(`💾 Все результаты сохранены в ${allResultsFile}`);
    
  } catch (error) {
    console.error(`❌ Произошла ошибка: ${error.message}`);
  } finally {
    // Закрываем браузер
    await browser.close();
    console.log('🔒 Браузер закрыт');
  }
}

// Запускаем основную функцию
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  searchQuery,
  searchQueryWithPagination,
  parseSearchResults
};
