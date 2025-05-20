/**
 * Модуль для взаимодействия с API сервиса 2captcha.com
 */

const axios = require('axios');
const { CAPTCHA_API_KEY } = require('./captcha-solver-v2');

/**
 * Отправка запроса в систему распознавания капчи
 * @param {string} sitekey - Ключ сайта с капчей
 * @param {string} pageUrl - URL страницы с капчей
 * @returns {Promise<string>} - ID задачи в системе 2captcha
 */
async function sendCaptchaToService(sitekey, pageUrl) {
  try {
    console.log('🔄 Отправка капчи на решение в 2captcha...');
    
    // URL для отправки Yandex SmartCaptcha
    const url = `https://2captcha.com/in.php?key=${CAPTCHA_API_KEY}&method=yandex&sitekey=${sitekey}&pageurl=${encodeURIComponent(pageUrl)}&json=1`;
    
    const response = await axios.get(url);
    
    if (response.data.status !== 1) {
      throw new Error(`Ошибка при отправке капчи: ${response.data.error}`);
    }
    
    console.log(`✅ Капча отправлена на решение, ID задачи: ${response.data.request}`);
    return response.data.request;
  } catch (error) {
    console.error(`❌ Ошибка при отправке капчи: ${error.message}`);
    throw error;
  }
}

/**
 * Получение результата решения капчи
 * @param {string} captchaId - ID задачи в системе 2captcha
 * @returns {Promise<string>} - Токен решения капчи
 */
async function getCaptchaResult(captchaId) {
  try {
    console.log('🔄 Ожидание результата решения капчи...');
    
    // Максимальное время ожидания 3 минуты с проверкой каждые 5 секунд
    const maxAttempts = 36;
    let currentAttempt = 0;
    
    while (currentAttempt < maxAttempts) {
      currentAttempt++;
      
      // Ждем 5 секунд перед очередной проверкой
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // URL для получения результата
      const url = `https://2captcha.com/res.php?key=${CAPTCHA_API_KEY}&action=get&id=${captchaId}&json=1`;
      
      const response = await axios.get(url);
      
      if (response.data.status === 1) {
        console.log('✅ Капча успешно решена!');
        return response.data.request;
      }
      
      if (response.data.request !== 'CAPCHA_NOT_READY') {
        throw new Error(`Ошибка при получении результата: ${response.data.request}`);
      }
      
      console.log(`⏳ Ожидание результата (попытка ${currentAttempt}/${maxAttempts})...`);
    }
    
    throw new Error('Превышено время ожидания решения капчи');
  } catch (error) {
    console.error(`❌ Ошибка при получении результата капчи: ${error.message}`);
    throw error;
  }
}

/**
 * Сообщить о неверном решении капчи, чтобы не списались средства
 * @param {string} captchaId - ID задачи в системе 2captcha
 * @returns {Promise<boolean>} - Результат отправки жалобы
 */
async function reportBadCaptcha(captchaId) {
  try {
    const url = `https://2captcha.com/res.php?key=${CAPTCHA_API_KEY}&action=reportbad&id=${captchaId}&json=1`;
    await axios.get(url);
    console.log('✅ Отправлен отчет о неудачном решении капчи');
    return true;
  } catch (error) {
    console.error(`❌ Ошибка при отправке отчета о неудачном решении: ${error.message}`);
    return false;
  }
}

module.exports = {
  sendCaptchaToService,
  getCaptchaResult,
  reportBadCaptcha
};
