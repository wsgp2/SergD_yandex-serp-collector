/**
 * Основной модуль для решения Yandex SmartCaptcha 
 * Обрабатывает все этапы решения капчи, включая чекбокс и токен
 */

const path = require('path');
const fs = require('fs-extra');

const { 
  detectCaptchaCheckbox, 
  makeScreenshot, 
  sleep 
} = require('./captcha-solver-v2');

const clickYandexCaptchaCheckbox = require('./captcha-click-fix');

const { 
  sendCaptchaToService, 
  getCaptchaResult, 
  reportBadCaptcha 
} = require('./captcha-api');

/**
 * Получение sitekey капчи из DOM страницы
 * @param {Object} page - Puppeteer страница
 * @returns {Promise<string>} - sitekey или null, если не найден
 */
async function getSiteKey(page) {
  try {
    console.log('🔍 Поиск sitekey на странице...');
    
    // Делаем скриншот для диагностики
    await makeScreenshot(page, 'sitekey-search');
    
    // Проверяем различные способы получения sitekey
    const sitekey = await page.evaluate(() => {
      // Способ 1: Поиск по data-sitekey
      const containers = [
        document.querySelector('#captcha-container'),
        document.querySelector('[data-sitekey]'),
        document.querySelector('.CheckboxCaptcha'),
        document.querySelector('.smartcaptcha')
      ].filter(Boolean);
      
      for (const container of containers) {
        const sitekey = container.getAttribute('data-sitekey');
        if (sitekey) return sitekey;
      }
      
      // Способ 2: Поиск в src iframe
      const frames = document.querySelectorAll('iframe[src*="captcha"]');
      for (const frame of frames) {
        const src = frame.getAttribute('src');
        if (!src) continue;
        
        try {
          const url = new URL(src);
          const sitekey = url.searchParams.get('k') || 
                          url.searchParams.get('sitekey') || 
                          '';
          if (sitekey) return sitekey;
        } catch (e) {}
      }
      
      // Способ 3: Поиск в исходном коде страницы
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const content = script.textContent || '';
        const match = content.match(/"sitekey":\s*"([^"]+)"/);
        if (match && match[1]) return match[1];
      }
      
      return null;
    });
    
    if (sitekey) {
      console.log(`✅ Найден sitekey: ${sitekey}`);
      return sitekey;
    }
    
    console.log('⚠️ sitekey не найден стандартными методами');
    
    // Если sitekey не найден, пробуем получить из URL страницы или другими методами
    const pageUrl = page.url();
    if (pageUrl.includes('captcha')) {
      const urlObj = new URL(pageUrl);
      const sitekeyFromUrl = urlObj.searchParams.get('k') || urlObj.searchParams.get('sitekey');
      
      if (sitekeyFromUrl) {
        console.log(`✅ Найден sitekey из URL: ${sitekeyFromUrl}`);
        return sitekeyFromUrl;
      }
    }
    
    console.log('❌ sitekey не найден');
    return null;
  } catch (error) {
    console.error(`❌ Ошибка при получении sitekey: ${error.message}`);
    return null;
  }
}

/**
 * Применяет решение капчи на странице
 * @param {Object} page - Puppeteer страница
 * @param {string} token - Токен решения капчи
 * @returns {Promise<boolean>} - Успешно ли применено решение
 */
async function applyCaptchaSolution(page, token) {
  try {
    console.log('🔄 Применение решения капчи на странице...');
    
    // Делаем скриншот перед применением решения
    await makeScreenshot(page, 'before-solution');
    
    // Пробуем найти поле для ввода токена и вставить в него решение
    const tokenApplied = await page.evaluate((captchaToken) => {
      // Ищем все возможные поля для ввода токена
      const inputSelectors = [
        'input[name="smart-token"]',
        'input[data-testid="smart-token"]',
        'input[name="captcha-token"]',
        'input[name="yandex_captcha_token"]',
        'input[name^="captcha"]',
        'input[type="hidden"][name*="captcha"]'
      ];
      
      for (const selector of inputSelectors) {
        const input = document.querySelector(selector);
        if (input) {
          input.value = captchaToken;
          console.log(`Токен вставлен в поле ${selector}`);
          return true;
        }
      }
      
      // Если не нашли подходящее поле, пробуем создать скрытый input
      const form = document.querySelector('form');
      if (form) {
        const hiddenInput = document.createElement('input');
        hiddenInput.type = 'hidden';
        hiddenInput.name = 'smart-token';
        hiddenInput.value = captchaToken;
        form.appendChild(hiddenInput);
        console.log('Создан скрытый input с токеном капчи');
        return true;
      }
      
      return false;
    }, token);
    
    if (!tokenApplied) {
      console.log('⚠️ Не удалось применить токен на странице');
      return false;
    }
    
    // Пробуем найти и нажать кнопку подтверждения
    const buttonSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      '.CheckboxCaptcha-Button',
      '.CaptchaButton',
      '.form__submit',
      'button[data-testid*="submit"]'
    ];
    
    let buttonClicked = false;
    
    for (const selector of buttonSelectors) {
      const buttonExists = await page.evaluate((sel) => {
        return !!document.querySelector(sel);
      }, selector);
      
      if (buttonExists) {
        await page.click(selector);
        console.log(`✅ Нажата кнопка подтверждения: ${selector}`);
        buttonClicked = true;
        break;
      }
    }
    
    if (!buttonClicked) {
      // Если не нашли кнопку, пробуем отправить форму программно
      const formSubmitted = await page.evaluate(() => {
        const form = document.querySelector('form');
        if (form) {
          form.submit();
          return true;
        }
        return false;
      });
      
      if (formSubmitted) {
        console.log('✅ Форма отправлена программно');
      } else {
        console.log('⚠️ Не удалось найти кнопку или форму для отправки');
      }
    }
    
    // Даем время на обработку решения
    await sleep(3000);
    
    // Проверяем, исчезла ли капча
    const captchaGone = await page.evaluate(() => {
      const captchaElements = [
        '.CheckboxCaptcha',
        '#captcha-container',
        '.Captcha',
        '.smartcaptcha'
      ];
      
      for (const selector of captchaElements) {
        if (document.querySelector(selector)) {
          return false;
        }
      }
      
      return true;
    });
    
    if (captchaGone) {
      console.log('✅ Капча успешно решена и исчезла!');
      return true;
    } else {
      console.log('⚠️ Капча все еще присутствует после применения решения');
      await makeScreenshot(page, 'after-solution-still-present');
      return false;
    }
  } catch (error) {
    console.error(`❌ Ошибка при применении решения капчи: ${error.message}`);
    return false;
  }
}

/**
 * Главная функция решения Yandex SmartCaptcha
 * @param {Object} page - Puppeteer страница
 * @returns {Promise<boolean>} - Успешно ли решена капча
 */
async function solveYandexCaptcha(page) {
  try {
    console.log('\n🤖 Запуск решения Yandex SmartCaptcha...');
    
    // Шаг 1: Проверяем наличие чекбокса капчи
    const hasCheckbox = await detectCaptchaCheckbox(page);
    
    // Шаг 2: Если есть чекбокс, кликаем по нему улучшенным методом
    if (hasCheckbox) {
      console.log('💪 Используем улучшенный метод клика по чекбоксу');
      const checkboxClicked = await clickYandexCaptchaCheckbox(page);
      
      if (!checkboxClicked) {
        console.log('⚠️ Не удалось кликнуть по чекбоксу капчи');
      } else {
        console.log('✅ Чекбокс капчи успешно отмечен!');
      }
      
      // Ждем после клика, чтобы могла появиться дополнительная капча
      console.log('⏳ Ожидание загрузки дополнительной капчи...');
      await sleep(3000);
      
      // Сохраняем HTML и скриншот после клика для анализа
      const resultsDir = path.join(process.cwd(), 'data', 'results');
      await fs.ensureDir(resultsDir);
      
      try {
        const html = await page.content();
        await fs.writeFile(path.join(resultsDir, 'captcha-after-click.html'), html);
        console.log('💾 Сохранен HTML страницы после клика для анализа');
        await makeScreenshot(page, 'after-click-analysis');
      } catch (err) {
        console.error(`❌ Ошибка при сохранении HTML: ${err.message}`);
      }
    }
    
    // Шаг 3: Получаем sitekey
    const sitekey = await getSiteKey(page);
    
    if (!sitekey) {
      console.log('⚠️ Не удалось получить sitekey, невозможно отправить капчу на решение');
      return false;
    }
    
    // Шаг 4: Отправляем капчу на решение
    const captchaId = await sendCaptchaToService(sitekey, page.url());
    
    // Шаг 5: Получаем результат решения
    const token = await getCaptchaResult(captchaId);
    
    // Шаг 6: Применяем решение на странице
    const applied = await applyCaptchaSolution(page, token);
    
    if (!applied) {
      console.log('⚠️ Не удалось применить решение капчи');
      await reportBadCaptcha(captchaId);
      return false;
    }
    
    // Шаг 7: Финальная проверка
    await sleep(2000);
    
    const captchaStillExists = await page.evaluate(() => {
      return !!document.querySelector('.CheckboxCaptcha, #captcha-container, .Captcha, .smartcaptcha');
    });
    
    if (captchaStillExists) {
      console.log('⚠️ Капча все еще присутствует после всех попыток решения');
      await reportBadCaptcha(captchaId);
      return false;
    }
    
    console.log('✅ Yandex SmartCaptcha успешно решена!');
    return true;
  } catch (error) {
    console.error(`❌ Ошибка при решении капчи: ${error.message}`);
    return false;
  }
}

module.exports = solveYandexCaptcha;
