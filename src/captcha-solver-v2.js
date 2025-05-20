/**
 * Модуль для решения капчи Яндекса с использованием сервиса 2captcha.com
 * Версия 2.0 - специализированная для работы с SmartCaptcha Яндекса и чекбоксами
 */

const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

// API ключ для сервиса 2captcha.com
const CAPTCHA_API_KEY = 'b32557628c97ea52019607e488533ad3';
const RESULTS_DIR = path.join(process.cwd(), 'data', 'results');

/**
 * Задержка на указанное количество миллисекунд
 * @param {number} ms - Количество миллисекунд
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Создает скриншот текущей страницы для диагностики
 * @param {Object} page - Puppeteer страница
 * @param {string} name - Имя файла
 * @returns {Promise<string>} - Путь к сохраненному скриншоту
 */
async function makeScreenshot(page, name = 'captcha-debug') {
  try {
    await fs.ensureDir(RESULTS_DIR);
    const screenshotPath = path.join(RESULTS_DIR, `${name}.png`);
    await page.screenshot({ path: screenshotPath });
    console.log(`📸 Сделан скриншот: ${screenshotPath}`);
    return screenshotPath;
  } catch (error) {
    console.error(`Ошибка при создании скриншота: ${error.message}`);
    return null;
  }
}

/**
 * Обнаруживает чекбокс капчи на странице
 * @param {Object} page - Puppeteer страница
 * @returns {Promise<boolean>} - true, если чекбокс найден
 */
async function detectCaptchaCheckbox(page) {
  try {
    // Проверяем различные селекторы, которые могут быть у чекбокса капчи
    const checkboxExists = await page.evaluate(() => {
      const selectors = [
        'input[type="checkbox"].CheckboxCaptcha-Anchor',
        '.CheckboxCaptcha',
        'iframe[name^="CheckboxCaptcha"]',
        'iframe[src*="captcha"]',
        '.smartcaptcha-btn',
        '#checkbox-captcha'
      ];
      
      for (const selector of selectors) {
        if (document.querySelector(selector)) {
          return true;
        }
      }
      
      return false;
    });
    
    if (checkboxExists) {
      console.log('✅ Обнаружен чекбокс капчи на странице');
      return true;
    }
    
    console.log('⚠️ Чекбокс капчи не обнаружен');
    return false;
  } catch (error) {
    console.error(`❌ Ошибка при поиске чекбокса капчи: ${error.message}`);
    return false;
  }
}

/**
 * Кликает по чекбоксу капчи
 * @param {Object} page - Puppeteer страница
 * @returns {Promise<boolean>} - true, если клик выполнен успешно
 */
async function clickCaptchaCheckbox(page) {
  try {
    // Делаем скриншот перед попыткой клика
    await makeScreenshot(page, 'before-checkbox-click');
    
    // Пробуем разные селекторы для клика
    const clicked = await page.evaluate(async () => {
      const selectors = [
        'input[type="checkbox"].CheckboxCaptcha-Anchor',
        '.CheckboxCaptcha-Anchor',
        '.smartcaptcha-btn',
        '.CheckboxCaptcha',
        '#checkbox-captcha'
      ];
      
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
          element.click();
          return true;
        }
      }
      
      // Если прямой клик не сработал, пробуем найти iframe с капчей
      const captchaIframe = document.querySelector('iframe[name^="CheckboxCaptcha"], iframe[src*="captcha"]');
      if (captchaIframe) {
        return false; // Требуется особая обработка фрейма
      }
      
      return false;
    });
    
    if (clicked) {
      console.log('✅ Успешный клик по чекбоксу капчи');
      // Ждем немного после клика для загрузки следующего этапа капчи
      await sleep(2000);
      return true;
    }
    
    // Если не смогли кликнуть напрямую, пробуем через iframe
    const frameExists = await page.evaluate(() => {
      return !!document.querySelector('iframe[name^="CheckboxCaptcha"], iframe[src*="captcha"]');
    });
    
    if (frameExists) {
      // Находим все фреймы
      const frames = await page.frames();
      
      // Ищем фрейм с капчей
      for (const frame of frames) {
        const frameName = await frame.name();
        const frameUrl = await frame.url();
        
        if (frameName.includes('captcha') || frameUrl.includes('captcha')) {
          console.log(`Найден фрейм капчи: ${frameName || frameUrl}`);
          
          // Ищем чекбокс внутри фрейма
          const checkboxInFrame = await frame.evaluate(() => {
            const checkbox = document.querySelector('input[type="checkbox"], .CheckboxCaptcha-Anchor, .smartcaptcha-btn');
            if (checkbox) {
              checkbox.click();
              return true;
            }
            return false;
          }).catch(() => false);
          
          if (checkboxInFrame) {
            console.log('✅ Успешный клик по чекбоксу внутри фрейма');
            await sleep(2000);
            return true;
          }
        }
      }
    }
    
    console.log('⚠️ Не удалось кликнуть по чекбоксу капчи');
    await makeScreenshot(page, 'failed-checkbox-click');
    return false;
  } catch (error) {
    console.error(`❌ Ошибка при клике по чекбоксу капчи: ${error.message}`);
    await makeScreenshot(page, 'error-checkbox-click');
    return false;
  }
}

module.exports = {
  CAPTCHA_API_KEY,
  makeScreenshot,
  sleep,
  detectCaptchaCheckbox,
  clickCaptchaCheckbox
};
