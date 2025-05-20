// Тестирование коллектора Яндекса с одним ключевым словом
const puppeteer = require('puppeteer');
const searchQueryWithPagination = require('./src/searchQueryWithPagination');

async function testCollector() {
  console.log('🚀 Запуск тестирования коллектора поисковых результатов Яндекса');
  
  // Запускаем браузер
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-infobars',
      '--window-position=0,0',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
      '--disable-extensions'
    ],
    ignoreHTTPSErrors: true,
    defaultViewport: null
  });
  
  try {
    // Тестируем один запрос
    const query = 'кредит для ИП без залога';
    console.log(`\n📊 Тестовый запрос: "${query}"`);
    
    // Выполняем поиск с пагинацией
    const results = await searchQueryWithPagination(browser, query);
    
    console.log(`\n✅ Тест завершен! Собрано ${results.length} результатов.`);
    
  } catch (error) {
    console.error(`❌ Ошибка при тестировании: ${error.message}`);
  } finally {
    // Закрываем браузер
    await browser.close();
    console.log('🔒 Браузер закрыт');
  }
}

// Запускаем тест
testCollector().catch(console.error);
