// Импорт необходимых модулей
const fs = require('fs-extra');
const path = require('path');
const moment = require('moment');
const { setTimeout } = require('timers/promises');
const solveYandexCaptcha = require('./yandex-captcha-solver');

// Константы
const BASE_URL = 'https://ya.ru/search'; // Базовый URL без параметров
const REGION_PARAM = '&lr=108975'; // Параметр региона
const RESULTS_DIR = path.join(__dirname, '..', 'data', 'results');
const MAX_PAGES_PER_QUERY = 10; // Максимальное количество страниц для сбора

// Добавляем внутреннюю функцию парсинга вместо импорта
// из основного модуля для избежания циркулярных зависимостей

// Ключевые слова для определения релевантности URL
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
 * Проверяет, содержит ли URL релевантные ключевые слова о кредитовании бизнеса
 * @param {string} url - URL для проверки
 * @returns {boolean} true, если URL содержит релевантные ключевые слова
 */
function isURLRelevant(url) {
  try {
    const urlLower = url.toLowerCase();
    return RELEVANT_KEYWORDS.some(keyword => urlLower.includes(keyword));
  } catch (e) {
    return false;
  }
}

/**
 * Парсит результаты поисковой выдачи Яндекса
 * @param {Page} page - Объект страницы Puppeteer
 * @param {number} pageNum - Номер текущей страницы (начиная с 0)
 * @returns {Promise<Array>} Массив результатов поиска
 */
async function parseSearchResults(page, pageNum = 0) {
  try {
    // Находим все блоки с результатами поиска
    const searchResults = await page.$$('.serp-item');
    console.log(`Всего найдено ${searchResults.length} результатов на странице ${pageNum + 1}`);
    
    // Массив для структурированного хранения результатов
    const organicResults = [];
    
    // Смещение для глобальной позиции (на основе номера страницы)
    const offset = pageNum * 10;
    
    // Обрабатываем каждый результат
    for (let i = 0; i < searchResults.length; i++) {
      try {
        const result = searchResults[i];
        
        // Получаем заголовок
        const titleElement = await result.$('.organic__url-text');
        if (!titleElement) continue;
        
        const title = await page.evaluate(el => el.textContent.trim(), titleElement);
        
        // Получаем URL
        const linkElement = await result.$('.organic__url');
        if (!linkElement) continue;
        
        const url = await page.evaluate(el => el.href, linkElement);
        
        // Проверяем, является ли это рекламной ссылкой
        if (url.includes('yabs.yandex.ru')) continue;
        
        // Получаем домен
        let domain;
        try {
          domain = new URL(url).hostname;
        } catch (e) {
          continue;
        }
        
        // Получаем текст сниппета (описание)
        const snippetElement = await result.$('.organic__text');
        const snippet = snippetElement ? 
          await page.evaluate(el => el.textContent.trim(), snippetElement) : 
          'Нет описания';
        
        // Проверяем релевантность URL
        const isRelevant = isURLRelevant(url);
        
        // Если URL релевантен, добавляем в результаты
        if (isRelevant) {
          organicResults.push({
            title,
            url,
            domain,
            snippet,
            pagePosition: i + 1,
            globalPosition: offset + i + 1
          });
          
          console.log(`✅ Результат ${i+1}: ${domain}`);
        }
      } catch (error) {
        console.error(`❌ Ошибка при обработке результата ${i+1}: ${error.message}`);
      }
    }
    
    return organicResults;
  } catch (error) {
    console.error(`❌ Ошибка при парсинге результатов: ${error.message}`);
    return [];
  }
}

/**
 * Создает случайную задержку между запросами
 * @returns {Promise<void>} Промис с задержкой
 */
async function randomDelay() {
  const MIN_DELAY = 3000;
  const MAX_DELAY = 7000;
  const delay = Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY + 1)) + MIN_DELAY;
  console.log(`⏱️ Задержка ${delay / 1000} секунд...`);
  await setTimeout(delay);
}

/**
 * Обрабатывает капчу на странице Яндекса - использует специализированное решение Yandex SmartCaptcha
 * @param {Page} page - Объект страницы Puppeteer
 * @returns {Promise<boolean>} Успешно ли решена капча
 */
async function handleCaptcha(page) {
  try {
    console.log('\n⚠️ Обнаружена капча!');
    
    // Пробуем решить капчу с помощью нового модуля
    console.log('🤖 Используем специализированный модуль для решения Yandex SmartCaptcha...');
    const autoSolved = await solveYandexCaptcha(page);
    
    if (autoSolved) {
      console.log('✅ Капча успешно решена с помощью 2captcha!');
      return true;
    }
    
    // Если автоматическое решение не удалось, переходим к ручному
    console.log('⚠️ Автоматическое решение не удалось. Переключение на ручное решение.');
    
    // Делаем скриншот для помощи в решении капчи
    const captchaScreenshotPath = path.join(RESULTS_DIR, 'captcha-manual.png');
    await page.screenshot({ path: captchaScreenshotPath });
    console.log(`📸 Сделан скриншот капчи для ручного решения: ${captchaScreenshotPath}`);
    
    // Сообщаем пользователю о необходимости ручного решения
    console.log('👤 ПОЖАЛУЙСТА, решите капчу вручную в открытом окне браузера.');
    
    // Сначала проверим, может капча уже решена автоматически
    console.log('⏳ Проверка состояния капчи после клика...');
    await setTimeout(3000); // Даем 3 секунды на обработку клика
    
    // Проверим, исчезла ли капча
    const captchaStillPresent = await page.evaluate(() => {
      return document.body.textContent.includes('Подтвердите, что запросы отправляли вы, а не робот') ||
             document.querySelector('.captcha') !== null ||
             document.querySelector('#captcha-container') !== null ||
             document.querySelector('.CheckboxCaptcha') !== null ||
             document.querySelector('.smartcaptcha') !== null;
    });
    
    if (!captchaStillPresent) {
      console.log('✅ Капча успешно решена автоматически!');
      return true;
    }
    
    // Если капча все еще присутствует, сообщаем о необходимости ручного решения
    console.log('⏳ Ожидание 20 секунд для ручного решения...');
    await setTimeout(20000); // Уменьшаем ожидание до 10 секунд
    
    // Финальная проверка после ожидания
    const captchaStillExists = await page.evaluate(() => {
      return document.body.textContent.includes('Подтвердите, что запросы отправляли вы, а не робот') ||
             document.querySelector('.captcha') !== null ||
             document.querySelector('#captcha-container') !== null ||
             document.querySelector('.CheckboxCaptcha') !== null ||
             document.querySelector('.smartcaptcha') !== null;
    });
    
    if (captchaStillExists) {
      console.log('❌ Капча все еще не решена. Завершение процесса.');
      return false;
    }
    
    console.log('✅ Капча успешно решена!');
    return true;
  } catch (error) {
    console.error(`❌ Ошибка при обработке капчи: ${error.message}`);
    return false;
  }
}

/**
 * Выполняет поисковый запрос в Яндексе и собирает данные со всех страниц
 * @param {Browser} browser - Объект браузера Puppeteer
 * @param {string} query - Поисковый запрос
 * @returns {Promise<Array>} Массив результатов поиска со всех страниц
 */
async function searchQueryWithPagination(browser, query) {
  console.log(`\n🔍 Выполняем поиск с пагинацией: "${query}"`);
  
  // Открываем новую страницу
  const page = await browser.newPage();
  
  // Устанавливаем User-Agent как обычный браузер
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  // Настраиваем размер области просмотра
  await page.setViewport({ width: 1366, height: 768 });
  
  // Массив для хранения всех результатов
  let allResults = [];
  
  try {
    // Счетчик страниц
    let pageNum = 0;
    
    // Проходим по всем страницам (до MAX_PAGES_PER_QUERY или до исчерпания результатов)
    while (pageNum < MAX_PAGES_PER_QUERY) {
      // Формируем URL запроса с параметром страницы
      const encodedQuery = encodeURIComponent(query);
      let searchUrl;
      
      // На Яндексе первая страница без параметра p, а на второй p=1 и так далее
      if (pageNum === 0) {
        // Первая страница без параметра p
        searchUrl = `${BASE_URL}?text=${encodedQuery}${REGION_PARAM}`;
      } else {
        // Для последующих страниц p=1 для второй страницы, p=2 для третьей и т.д.
        searchUrl = `${BASE_URL}?text=${encodedQuery}${REGION_PARAM}&p=${pageNum}`;
      }
      
      console.log(`URL следующей страницы: ${searchUrl}`);
      
      console.log(`📄 Загрузка страницы ${pageNum + 1}...`);
      
      // Переходим на страницу поиска
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      console.log('📄 Страница загружена');
      
      // Даем странице время для рендеринга
      await setTimeout(2000);
      
      // Проверяем, есть ли капча
      const hasCaptcha = await page.evaluate(() => {
        return document.body.textContent.includes('Подтвердите, что запросы отправляли вы, а не робот') ||
               document.querySelector('.captcha') !== null ||
               document.querySelector('#captcha-container') !== null ||
               document.querySelector('.CheckboxCaptcha') !== null;
      });
      
      if (hasCaptcha) {
        // Вызываем функцию для ожидания решения капчи человеком
        const captchaSolved = await handleCaptcha(page);
        
        if (!captchaSolved) {
          // Если капча не решена, прекращаем и возвращаем собранные результаты
          console.log('⚠️ Не удалось решить капчу. Возвращаем уже собранные результаты.');
          return allResults; // Возвращаем то, что успели собрать до капчи
        }
        
        // Если капча решена, продолжаем нормальную работу
        console.log('✅ Продолжаем сбор данных...');
      }
      
      // Парсим результаты поиска на текущей странице
      const pageResults = await parseSearchResults(page, pageNum);
      console.log(`✅ Получено ${pageResults.length} результатов на странице ${pageNum + 1}`);
      
      // Добавляем результаты в общий массив
      allResults = allResults.concat(pageResults);
      
      // Просто проверяем, собрали ли мы уже достаточно результатов или на странице нет результатов
      // Если на странице нет результатов или уже достигли максимального количества страниц, выходим из цикла
      if (pageResults.length === 0 || pageNum >= MAX_PAGES_PER_QUERY - 1 || allResults.length >= 100) {
        console.log(`Завершение перехода по страницам: ${pageResults.length === 0 ? 'нет результатов' : 'достигнуто максимальное количество'}`);
        break;
      }
      
      // Увеличиваем счетчик страниц для следующей итерации
      pageNum++;
      
      // Делаем небольшую задержку между страницами
      if (pageNum < MAX_PAGES_PER_QUERY) {
        console.log(`\n🔴 ПЕРЕХОД НА СТРАНИЦУ ${pageNum + 1} 🔴`);
        // Для следующей страницы параметр p равен номеру страницы
        const nextPageUrl = `${BASE_URL}?text=${encodedQuery}${REGION_PARAM}&p=${pageNum}`;
        console.log(`URL следующей страницы: ${nextPageUrl}`);
        console.log(`Ожидание перед переходом...`);
        await randomDelay();  // Задержка перед переходом к следующей странице
      }
    }
    
    console.log(`✅ Всего собрано ${allResults.length} результатов по запросу "${query}"`);
    
    // Сохраняем результаты
    const timestamp = moment().format('YYYY-MM-DD_HH-mm');
    const searchResultsFile = path.join(RESULTS_DIR, `${query.replace(/\\s+/g, '_')}_${timestamp}.json`);
    
    await fs.ensureDir(RESULTS_DIR);
    await fs.writeJson(searchResultsFile, allResults, { spaces: 2 });
    console.log(`💾 Результаты сохранены в ${searchResultsFile}`);
    
    return allResults;
  } catch (error) {
    console.error(`❌ Ошибка при поиске "${query}": ${error.message}`);
    return [];
  } finally {
    await page.close();
  }
}

module.exports = searchQueryWithPagination;
