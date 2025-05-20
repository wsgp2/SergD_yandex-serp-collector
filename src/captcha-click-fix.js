/**
 * Улучшенная функция для надежного клика по чекбоксу SmartCaptcha Яндекса
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs-extra');

/**
 * Создает скриншот текущей страницы
 * @param {Object} page - Puppeteer страница
 * @param {string} name - Имя файла для скриншота
 * @returns {Promise<string>} - Путь к файлу скриншота
 */
async function takeScreenshot(page, name) {
  const resultsDir = path.join(process.cwd(), 'data', 'results');
  await fs.ensureDir(resultsDir);
  const screenshotPath = path.join(resultsDir, `${name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`📸 Сделан скриншот: ${screenshotPath}`);
  return screenshotPath;
}

/**
 * Задержка на указанное количество миллисекунд
 * @param {number} ms - Количество миллисекунд
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Клик по чекбоксу капчи Яндекса
 * @param {Object} page - Puppeteer страница
 * @returns {Promise<boolean>} - Результат клика
 */
async function clickYandexCaptchaCheckbox(page) {
  try {
    // Делаем скриншот до клика
    await takeScreenshot(page, 'before-click');
    
    // Показываем элементы на странице для диагностики
    const elements = await page.evaluate(() => {
      const captchaElements = [];
      document.querySelectorAll('*').forEach(el => {
        let hasMatchId = false;
        let hasMatchClass = false;
        
        // Проверяем ID
        if (el.id && typeof el.id === 'string') {
          hasMatchId = el.id.toLowerCase().includes('captcha');
        }
        
        // Проверяем className (может быть строкой или DOMTokenList)
        if (el.className) {
          if (typeof el.className === 'string') {
            hasMatchClass = el.className.toLowerCase().includes('captcha');
          } else if (el.className.baseVal) { // Для SVG элементов
            hasMatchClass = el.className.baseVal.toLowerCase().includes('captcha');
          } else if (el.classList && el.classList.length) { // Используем classList
            hasMatchClass = Array.from(el.classList).some(c => c.toLowerCase().includes('captcha'));
          }
        }
        
        if (hasMatchId || hasMatchClass) {
          captchaElements.push({
            tag: el.tagName,
            id: el.id || '',
            class: typeof el.className === 'string' ? el.className : 
                  el.className && el.className.baseVal ? el.className.baseVal : 
                  el.classList ? Array.from(el.classList).join(' ') : ''
          });
        }
      });
      return captchaElements;
    });
    
    console.log('📋 Найденные элементы капчи:', JSON.stringify(elements, null, 2));
    
    // Метод 1: Прямой клик по координатам чекбокса
    try {
      // Находим положение чекбокса
      const checkboxRect = await page.evaluate(() => {
        // Селекторы чекбокса капчи Яндекса
        const selectors = [
          '.CheckboxCaptcha-Checkbox',
          '.CheckboxCaptcha',
          '.smartcaptcha-checkbox',
          '.Checkbox-Control',
          'input[type="checkbox"][class*="checkbox"]',
          '[role="checkbox"]',
          '.sc-button'
        ];
        
        for (const selector of selectors) {
          const checkbox = document.querySelector(selector);
          if (checkbox) {
            const rect = checkbox.getBoundingClientRect();
            return {
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
              width: rect.width,
              height: rect.height
            };
          }
        }
        
        // Если не нашли по селекторам, берем область где должен быть чекбокс
        const captchaContainer = document.querySelector('.CheckboxCaptcha, .smartcaptcha, #captcha-container');
        if (captchaContainer) {
          const rect = captchaContainer.getBoundingClientRect();
          // Предполагаем что чекбокс в левой части контейнера
          return {
            x: rect.left + 40,
            y: rect.top + rect.height / 2,
            width: 30,
            height: 30
          };
        }
        
        return null;
      });
      
      if (checkboxRect) {
        console.log(`🖱️ Кликаем по чекбоксу по координатам: x=${checkboxRect.x}, y=${checkboxRect.y}`);
        await page.mouse.click(checkboxRect.x, checkboxRect.y);
        console.log('✅ Выполнен клик по координатам чекбокса');
      } else {
        console.log('⚠️ Не удалось определить координаты чекбокса');
      }
    } catch (clickError) {
      console.error(`❌ Ошибка при клике по координатам: ${clickError.message}`);
    }
    
    // Даем время на реакцию
    await sleep(2000);
    
    // Метод 2: Клик по элементу с JavaScript
    try {
      await page.evaluate(() => {
        const selectors = [
          '.CheckboxCaptcha-Checkbox',
          '.CheckboxCaptcha',
          '.smartcaptcha-checkbox',
          '.Checkbox-Control',
          '.sc-button',
          'input[type="checkbox"][class*="checkbox"]',
          '[role="checkbox"]'
        ];
        
        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (element) {
            // Создаем событие клика
            const clickEvent = new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              view: window
            });
            element.dispatchEvent(clickEvent);
            console.log(`Выполнен JS-клик по селектору: ${selector}`);
            return true;
          }
        }
        
        return false;
      });
      
      console.log('✅ Выполнен JavaScript клик по чекбоксу');
    } catch (jsError) {
      console.error(`❌ Ошибка при JS клике: ${jsError.message}`);
    }
    
    // Делаем скриншот после клика
    await takeScreenshot(page, 'after-click');
    
    // Проверяем, изменилось ли состояние чекбокса
    const checkboxChanged = await page.evaluate(() => {
      const selectors = [
        '.CheckboxCaptcha-Checkbox:checked',
        '.CheckboxCaptcha.CheckboxCaptcha_checked',
        'input[type="checkbox"][class*="checkbox"]:checked',
        '.smartcaptcha-checkbox.checked',
        '[role="checkbox"][aria-checked="true"]'
      ];
      
      for (const selector of selectors) {
        if (document.querySelector(selector)) {
          return true;
        }
      }
      
      return false;
    });
    
    if (checkboxChanged) {
      console.log('✅ Чекбокс капчи успешно отмечен!');
      return true;
    }
    
    console.log('⚠️ Не удалось отметить чекбокс капчи');
    return false;
  } catch (error) {
    console.error(`❌ Ошибка при клике по чекбоксу: ${error.message}`);
    return false;
  }
}

module.exports = clickYandexCaptchaCheckbox;
