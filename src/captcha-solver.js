/**
 * Модуль для автоматического решения капчи Яндекса с использованием сервиса 2captcha.com
 */

const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

// API ключ для сервиса 2captcha.com
const CAPTCHA_API_KEY = 'b32557628c97ea52019607e488533ad3';

/**
 * Получение sitekey с текущей страницы
 * @param {Object} page - Puppeteer страница
 * @returns {Promise<string>} - Значение sitekey
 */
async function getSitekey(page) {
  try {
    return await page.evaluate(() => {
      const container = document.querySelector('[data-sitekey]') || 
                         document.querySelector('#captcha-container') ||
                         document.querySelector('.CheckboxCaptcha-Anchor');
      
      if (!container) {
        throw new Error('Элемент капчи не найден');
      }
      
      return container.getAttribute('data-sitekey');
    });
  } catch (error) {
    console.error('Ошибка при получении sitekey:', error.message);
    // Если не удалось получить через data-sitekey, попробуем другой метод
    try {
      await page.screenshot({ path: path.join(process.cwd(), 'data', 'results', 'captcha-debug.png') });
      console.log('Сделан скриншот капчи для отладки: captcha-debug.png');
      
      // Получим доступный HTML элемента с капчей для диагностики
      const captchaHTML = await page.evaluate(() => {
        const captchaEl = document.querySelector('.CheckboxCaptcha') || 
                          document.querySelector('#captcha-container') ||
                          document.querySelector('form');
        return captchaEl ? captchaEl.outerHTML : 'Элемент капчи не найден';
      });
      
      console.log('HTML капчи:', captchaHTML);
      
      // Попытка получить sitekey из iframe
      const sitekey = await page.evaluate(() => {
        const iframe = document.querySelector('iframe[src*="smart-captcha"]');
        if (iframe) {
          const srcUrl = new URL(iframe.src);
          return srcUrl.searchParams.get('k') || '';
        }
        return '';
      });
      
      if (sitekey) {
        return sitekey;
      }
      
      throw new Error('Невозможно определить sitekey');
    } catch (secondError) {
      console.error('Критическая ошибка при получении sitekey:', secondError.message);
      throw secondError;
    }
  }
}

/**
 * Отправка капчи на решение в сервис 2captcha.com
 * @param {string} sitekey - Значение sitekey с Яндекса
 * @param {string} pageUrl - URL страницы с капчей
 * @returns {Promise<string>} - Токен с решением капчи
 */
async function sendCaptchaToSolver(sitekey, pageUrl) {
  try {
    console.log(`Отправка Yandex SmartCaptcha на решение с sitekey: ${sitekey}`);
    
    // Шаг 1: Отправляем капчу на решение
    const requestUrl = `https://2captcha.com/in.php?key=${CAPTCHA_API_KEY}&method=yandex&sitekey=${sitekey}&pageurl=${encodeURIComponent(pageUrl)}&json=1`;
    
    const response = await axios.get(requestUrl);
    
    if (response.data.status !== 1) {
      throw new Error(`Ошибка при отправке капчи: ${response.data.error}`);
    }
    
    const captchaId = response.data.request;
    console.log(`Капча успешно отправлена. ID задачи: ${captchaId}`);
    
    // Шаг 2: Ожидаем решения (с интервалом проверки 5 секунд)
    let result = null;
    let attempts = 0;
    const maxAttempts = 30; // Максимум 150 секунд ожидания
    
    while (!result && attempts < maxAttempts) {
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 5000)); // Ждем 5 секунд
      
      console.log(`Проверка результата решения капчи (попытка ${attempts}/${maxAttempts})...`);
      
      const resultResponse = await axios.get(`https://2captcha.com/res.php?key=${CAPTCHA_API_KEY}&action=get&id=${captchaId}&json=1`);
      
      if (resultResponse.data.status === 1) {
        result = resultResponse.data.request;
        break;
      }
      
      if (resultResponse.data.request !== 'CAPCHA_NOT_READY') {
        throw new Error(`Ошибка при получении результата: ${resultResponse.data.request}`);
      }
    }
    
    if (!result) {
      throw new Error('Превышено время ожидания решения капчи');
    }
    
    console.log('Капча успешно решена!');
    return result;
    
  } catch (error) {
    console.error('Ошибка при решении капчи:', error.message);
    throw error;
  }
}

/**
 * Применяет решение капчи на странице
 * @param {Object} page - Puppeteer страница
 * @param {string} token - Токен с решением капчи
 * @returns {Promise<boolean>} - Результат применения решения
 */
async function applyCaptchaSolution(page, token) {
  try {
    // Попытка найти правильный элемент ввода для SmartCaptcha токена
    await page.evaluate((captchaToken) => {
      // Поиск различных вариантов полей для ввода токена
      const tokenInput = document.querySelector('input[name="smart-token"]') || 
                          document.querySelector('input[data-testid="smart-token"]') || 
                          document.querySelector('input[name="captcha-token"]') ||
                          document.querySelector('input[name="yandex_captcha_token"]');
      
      if (tokenInput) {
        tokenInput.value = captchaToken;
        console.log('Токен капчи успешно вставлен в поле ввода');
      } else {
        // Если не нашли стандартные элементы, создадим скрытое поле и вставим токен
        const form = document.querySelector('form');
        if (form) {
          const input = document.createElement('input');
          input.type = 'hidden';
          input.name = 'smart-token';
          input.value = captchaToken;
          form.appendChild(input);
          console.log('Создано скрытое поле для токена капчи');
        } else {
          throw new Error('Не найдена форма для вставки токена капчи');
        }
      }
    }, token);

    // Клик по кнопке подтверждения капчи
    try {
      // Пробуем найти разные варианты кнопок подтверждения
      const buttonSelectors = [
        '.CheckboxCaptcha-Button',
        'button[type="submit"]',
        'input[type="submit"]',
        '.CaptchaButton',
        '.form__submit'
      ];

      for (const selector of buttonSelectors) {
        const buttonExists = await page.evaluate((sel) => {
          const button = document.querySelector(sel);
          return !!button;
        }, selector);

        if (buttonExists) {
          await page.click(selector);
          console.log(`Нажата кнопка подтверждения капчи: ${selector}`);
          break;
        }
      }

      // Если форма - последняя проверка
      const formExists = await page.evaluate(() => {
        return !!document.querySelector('form');
      });

      if (formExists) {
        await page.evaluate(() => {
          document.querySelector('form').submit();
        });
        console.log('Форма отправлена после вставки токена капчи');
      }

    } catch (clickError) {
      console.warn('Предупреждение: не удалось кликнуть кнопку капчи автоматически:', clickError.message);
      console.log('Попытка отправить форму программно...');
      
      await page.evaluate(() => {
        const form = document.querySelector('form');
        if (form) form.submit();
      });
    }

    // Даем время на обработку решения
    await page.waitForTimeout(3000);
    
    // Проверяем, исчезла ли капча
    const captchaStillExists = await page.evaluate(() => {
      return !!document.querySelector('.CheckboxCaptcha') || 
             !!document.querySelector('#captcha-container');
    });

    return !captchaStillExists;
    
  } catch (error) {
    console.error('Ошибка при применении решения капчи:', error.message);
    return false;
  }
}

/**
 * Основная функция для решения капчи
 * @param {Object} page - Puppeteer страница
 * @returns {Promise<boolean>} - Успешно ли решена капча
 */
async function solveCaptcha(page) {
  try {
    console.log('🤖 Запуск автоматического решения капчи...');
    
    // Сделаем скриншот капчи для диагностики
    const captchaScreenshotPath = path.join(process.cwd(), 'data', 'results', 'captcha-auto.png');
    await page.screenshot({ path: captchaScreenshotPath });
    console.log(`📸 Сделан скриншот капчи: ${captchaScreenshotPath}`);
    
    // Получаем sitekey
    const sitekey = await getSitekey(page);
    if (!sitekey) {
      throw new Error('Не удалось получить sitekey');
    }
    
    // Отправляем капчу на решение
    const token = await sendCaptchaToSolver(sitekey, page.url());
    
    // Применяем решение
    const success = await applyCaptchaSolution(page, token);
    
    if (success) {
      console.log('✅ Капча успешно решена и подтверждена!');
    } else {
      console.warn('⚠️ Решение применено, но капча может еще присутствовать. Проверьте результат.');
    }
    
    return success;
    
  } catch (error) {
    console.error('❌ Ошибка при решении капчи:', error.message);
    // Отправим отчет о неудачном решении, чтобы не списывались деньги
    try {
      if (error.message.includes('sitekey')) {
        console.log('Проблема с определением sitekey, невозможно отправить отчет');
      } else {
        await axios.get(`https://2captcha.com/res.php?key=${CAPTCHA_API_KEY}&action=reportbad&json=1`);
        console.log('Отправлен отчет о неудачном решении капчи');
      }
    } catch (reportError) {
      console.error('Ошибка при отправке отчета:', reportError.message);
    }
    return false;
  }
}

module.exports = {
  solveCaptcha,
  CAPTCHA_API_KEY
};
