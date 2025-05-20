/**
 * Обработчик результатов поисковой выдачи Яндекса
 * Собирает все результаты, фильтрует их и сохраняет в CSV и JSON
 */

const fs = require('fs-extra');
const path = require('path');
const moment = require('moment');

// Константы
const RESULTS_DIR = path.join(__dirname, '..', 'data', 'results');
const PROCESSED_DIR = path.join(__dirname, '..', 'data', 'processed');

// Список исключаемых доменов (банки и агрегаторы)
const EXCLUDED_DOMAINS = [
  'sberbank.ru',
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

/**
 * Загружает все JSON файлы с результатами поиска
 * @returns {Promise<Array>} Массив с данными всех результатов
 */
async function loadAllResults() {
  console.log(`🔍 Загрузка результатов из директории: ${RESULTS_DIR}`);
  
  try {
    // Получаем список всех файлов в директории
    const files = await fs.readdir(RESULTS_DIR);
    
    // Фильтруем только JSON файлы с результатами поиска
    const resultFiles = files.filter(file => 
      file.endsWith('.json') && !file.startsWith('processed_') && !file.startsWith('all_')
    );
    
    console.log(`📄 Найдено ${resultFiles.length} файлов с результатами`);
    
    if (resultFiles.length === 0) {
      console.log('⚠️ Результаты не найдены. Запустите сначала сбор данных.');
      return [];
    }
    
    // Загружаем данные из всех файлов
    let allResults = [];
    
    for (const file of resultFiles) {
      const filePath = path.join(RESULTS_DIR, file);
      const data = await fs.readJson(filePath);
      console.log(`✅ Загружено ${data.length} результатов из файла ${file}`);
      allResults = allResults.concat(data);
    }
    
    console.log(`📊 Всего загружено ${allResults.length} результатов`);
    return allResults;
  } catch (error) {
    console.error(`❌ Ошибка при загрузке результатов: ${error.message}`);
    return [];
  }
}

/**
 * Фильтрует результаты, удаляя дубликаты и исключая определенные домены
 * @param {Array} results - Массив результатов поиска
 * @returns {Array} Отфильтрованный массив результатов
 */
function filterResults(results) {
  console.log('🔍 Фильтрация результатов...');
  
  // Удаляем дубликаты URL
  const uniqueUrls = new Set();
  const uniqueResults = results.filter(result => {
    if (!uniqueUrls.has(result.url)) {
      uniqueUrls.add(result.url);
      return true;
    }
    return false;
  });
  
  console.log(`✅ Удалено ${results.length - uniqueResults.length} дубликатов`);
  
  // Фильтруем по исключаемым доменам
  const filteredResults = uniqueResults.filter(result => {
    const domain = result.domain;
    return !EXCLUDED_DOMAINS.some(excluded => domain.includes(excluded));
  });
  
  console.log(`✅ Удалено ${uniqueResults.length - filteredResults.length} результатов из исключенных доменов`);
  
  return filteredResults;
}

/**
 * Сохраняет результаты в файл CSV
 * @param {Array} results - Массив отфильтрованных результатов
 * @returns {Promise<string>} Путь к сохраненному файлу
 */
async function saveToCSV(results) {
  console.log('💾 Сохранение результатов в CSV...');
  
  // Создаем директорию, если она не существует
  await fs.ensureDir(PROCESSED_DIR);
  
  // Формируем имя файла с временной меткой
  const timestamp = moment().format('YYYY-MM-DD_HH-mm');
  const csvFilePath = path.join(PROCESSED_DIR, `yandex_results_${timestamp}.csv`);
  
  // Создаем заголовок CSV
  const csvHeader = 'Title,URL,Domain,Snippet\n';
  
  // Преобразуем результаты в строки CSV
  const csvRows = results.map(result => {
    const title = result.title.replace(/"/g, '""').replace(/,/g, ' ');
    const url = result.url.replace(/"/g, '""');
    const domain = result.domain.replace(/"/g, '""');
    const snippet = result.snippet.replace(/"/g, '""').replace(/,/g, ' ').replace(/\\n/g, ' ');
    
    return `"${title}","${url}","${domain}","${snippet}"`;
  });
  
  // Объединяем все в один CSV-контент
  const csvContent = csvHeader + csvRows.join('\n');
  
  // Записываем в файл
  await fs.writeFile(csvFilePath, csvContent, 'utf8');
  console.log(`✅ Результаты сохранены в CSV: ${csvFilePath}`);
  
  return csvFilePath;
}

/**
 * Сохраняет результаты в файл JSON
 * @param {Array} results - Массив отфильтрованных результатов
 * @returns {Promise<string>} Путь к сохраненному файлу
 */
async function saveToJson(results) {
  console.log('💾 Сохранение результатов в JSON...');
  
  // Создаем директорию, если она не существует
  await fs.ensureDir(PROCESSED_DIR);
  
  // Формируем имя файла с временной меткой
  const timestamp = moment().format('YYYY-MM-DD_HH-mm');
  const jsonFilePath = path.join(PROCESSED_DIR, `yandex_results_${timestamp}.json`);
  
  // Записываем в файл
  await fs.writeJson(jsonFilePath, results, { spaces: 2 });
  console.log(`✅ Результаты сохранены в JSON: ${jsonFilePath}`);
  
  return jsonFilePath;
}

/**
 * Сохраняет список доменов в текстовый файл
 * @param {Array} results - Массив отфильтрованных результатов
 * @returns {Promise<string>} Путь к сохраненному файлу
 */
async function saveDomainsList(results) {
  console.log('💾 Сохранение списка доменов...');
  
  // Создаем директорию, если она не существует
  await fs.ensureDir(PROCESSED_DIR);
  
  // Извлекаем уникальные домены
  const domains = [...new Set(results.map(result => result.domain))];
  
  // Формируем имя файла
  const domainsFilePath = path.join(PROCESSED_DIR, 'yandex_domains.txt');
  
  // Записываем домены в файл построчно
  await fs.writeFile(domainsFilePath, domains.join('\n'), 'utf8');
  console.log(`✅ Список из ${domains.length} доменов сохранен в: ${domainsFilePath}`);
  
  return domainsFilePath;
}

/**
 * Основная функция для обработки результатов
 */
async function main() {
  console.log('🚀 Запуск обработки результатов поиска Яндекса');
  
  // Загружаем все результаты
  const allResults = await loadAllResults();
  
  if (allResults.length === 0) {
    console.log('❌ Нет данных для обработки. Завершение работы.');
    return;
  }
  
  // Фильтруем результаты
  const filteredResults = filterResults(allResults);
  console.log(`📊 После фильтрации осталось ${filteredResults.length} результатов`);
  
  // Сохраняем результаты в разных форматах
  const csvFilePath = await saveToCSV(filteredResults);
  const jsonFilePath = await saveToJson(filteredResults);
  const domainsFilePath = await saveDomainsList(filteredResults);
  
  console.log('\n✅ Обработка завершена успешно!');
  console.log(`📄 CSV файл: ${csvFilePath}`);
  console.log(`📄 JSON файл: ${jsonFilePath}`);
  console.log(`📄 Список доменов: ${domainsFilePath}`);
}

// Запускаем основную функцию
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  loadAllResults,
  filterResults,
  saveToCSV,
  saveToJson,
  saveDomainsList
};
