const fs = require('fs');
const path = require('path');

// ==================== СИСТЕМА ПАМЯТИ ====================
class MemorySystem {
    constructor() {
        this.memoryPath = path.join(__dirname, '../data/memory.json');
        this.memories = {};
        this.loadMemory();
    }

    loadMemory() {
        try {
            if (fs.existsSync(this.memoryPath)) {
                const data = fs.readFileSync(this.memoryPath, 'utf8');
                this.memories = JSON.parse(data);
                console.log(`✅ Загружено ${Object.keys(this.memories).length} пользователей в памяти`);
            }
        } catch (error) {
            console.log('📁 Создаю новую базу памяти...');
            this.memories = {};
            this.saveMemory();
        }
    }

    saveMemory() {
        try {
            fs.mkdirSync(path.dirname(this.memoryPath), { recursive: true });
            fs.writeFileSync(this.memoryPath, JSON.stringify(this.memories, null, 2));
        } catch (error) {
            console.error('❌ Ошибка сохранения памяти:', error);
        }
    }

    remember(userId, key, value) {
        if (!this.memories[userId]) {
            this.memories[userId] = {};
        }
        this.memories[userId][key] = {
            value: value,
            timestamp: Date.now(),
            accessed: 0
        };
        this.saveMemory();
        return `Запомнил "${value}" как ${key}`;
    }

    recall(userId, key) {
        if (this.memories[userId] && this.memories[userId][key]) {
            this.memories[userId][key].accessed++;
            this.memories[userId][key].lastAccessed = Date.now();
            this.saveMemory();
            return this.memories[userId][key].value;
        }
        return null;
    }

    forget(userId, key) {
        if (this.memories[userId] && this.memories[userId][key]) {
            const value = this.memories[userId][key].value;
            delete this.memories[userId][key];
            this.saveMemory();
            return `Забыл "${value}"`;
        }
        return 'Нечего забывать';
    }

    getUserMemory(userId) {
        return this.memories[userId] || {};
    }

    getAllMemories() {
        return this.memories;
    }
}

// ==================== ОСНОВНОЙ AI КЛАСС ====================
class LocalAI {
    constructor() {
        this.context = [];
        this.maxContextLength = 10;
        this.memory = new MemorySystem();
        this.userStates = {}; // Для отслеживания состояния диалога
        
        // База знаний и правил
        this.rules = {
            greetings: {
                patterns: ['привет', 'здравствуй', 'hello', 'hi', 'хай', 'добрый день', 'доброе утро', 'добрый вечер'],
                responses: [
                    'Привет! Как дела?',
                    'Здравствуй! Рад тебя видеть!',
                    'Привет-привет! Чем могу помочь?',
                    'Приветствую! Что нового?'
                ],
                weight: 1.0
            },
            howAreYou: {
                patterns: ['как дела', 'как ты', 'how are you', 'как жизнь', 'как сам', 'как настроение'],
                responses: [
                    'У меня всё отлично, спасибо что спросил!',
                    'Работаю как всегда! А у тебя как?',
                    'Всё хорошо, готов помогать!',
                    'Прекрасно! Общаюсь с тобой :)'
                ],
                weight: 1.0
            },
            farewell: {
                patterns: ['пока', 'до свидания', 'goodbye', 'see you', 'спасибо пока', 'увидимся'],
                responses: [
                    'Пока! Буду ждать нашей следующей встречи!',
                    'До свидания! Хорошего дня!',
                    'Пока-пока! Возвращайся скорее!',
                    'Всего доброго!'
                ],
                weight: 1.0
            },
            thanks: {
                patterns: ['спасибо', 'thank you', 'благодарю', 'thanks', 'мерси'],
                responses: [
                    'Всегда рад помочь!',
                    'Пожалуйста! Обращайся ещё!',
                    'Рад был помочь!',
                    'Не за что!'
                ],
                weight: 1.0
            },
            weather: {
                patterns: ['погода', 'weather', 'дождь', 'солнце', 'холодно', 'жарко', 'снег', 'град'],
                responses: [
                    'Я не могу проверить погоду, но надеюсь, что она хорошая!',
                    'Рекомендую посмотреть в окно или проверить погодный сервис :)',
                    'В моём процессоре всегда +25°C и солнечно!',
                    'За окном... ой, у меня нет окон!'
                ],
                weight: 0.8
            },
            time: {
                patterns: ['который час', 'сколько время', 'what time', 'время', 'дата'],
                responses: [
                    `Сейчас: ${new Date().toLocaleTimeString('ru-RU')}, ${new Date().toLocaleDateString('ru-RU')}`,
                    `Мои часы показывают: ${new Date().toLocaleString('ru-RU')}`,
                    `Время: ${new Date().getHours()}:${new Date().getMinutes().toString().padStart(2, '0')}`
                ],
                weight: 0.9
            },
            math: {
                patterns: ['сколько будет', 'посчитай', 'calculate', 'реши', 'вычисли', '\\d+[+\\-*/]\\d+', '\\d+\\s*[+\\-*/]\\s*\\d+'],
                responses: [], // Специальная обработка
                weight: 1.0
            },
            whoAreYou: {
                patterns: ['кто ты', 'what are you', 'твой создатель', 'кто тебя создал', 'твоё имя'],
                responses: [
                    'Я — локальный AI бот без внешних API! Создан для общения в Discord.',
                    'Простой, но умный бот, работающий полностью оффлайн!',
                    'Я самодельный искусственный интеллект. Меня создали с помощью discord.js!',
                    'Бот с локальным ИИ. Не использую никакие ключи или внешние сервисы!'
                ],
                weight: 1.0
            },
            help: {
                patterns: ['помощь', 'help', 'команды', 'что умеешь', 'функции'],
                responses: [
                    '**Я умею:**\n' +
                    '• Общаться на разные темы\n' +
                    '• Решать простые математические примеры (2+2, 10*5)\n' +
                    '• Запоминать информацию (скажи "запомни, что...")\n' +
                    '• Вспоминать что-либо (спроси "что ты знаешь обо мне?")\n' +
                    '• Отвечать на вопросы о погоде, времени и т.д.\n\n' +
                    'Просто напиши мне что-нибудь!'
                ],
                weight: 1.0
            },
            joke: {
                patterns: ['шутка', 'анекдот', 'расскажи шутку', 'joke', 'пошути'],
                responses: [
                    'Почему программисты путают Хэллоуин и Рождество? Потому что Oct 31 == Dec 25!',
                    'Как называют программиста, который боится женщин? Гитхаб!',
                    'Сколько нужно программистов, чтобы вкрутить лампочку? Ни одного, это hardware проблема!',
                    'Почему Java-программисты носят очки? Потому что они не C#!'
                ],
                weight: 0.7
            }
        };

        // Правила для извлечения информации
        this.extractionRules = {
            name: {
                patterns: ['меня зовут', 'мое имя', 'я -', 'я —', 'зовут', 'name is'],
                extract: (msg) => {
                    const regex = /(?:меня зовут|мое имя|я[-\s])(?:[,\s]*)?([^.!?]+)/i;
                    const match = msg.match(regex);
                    return match ? match[1].trim().replace(/[.!?,]$/, '') : null;
                },
                response: (name) => `Приятно познакомиться, ${name}! Запомнил твоё имя.`
            },
            remember: {
                patterns: ['запомни', 'remember', 'не забудь', 'запиши', 'запомни что'],
                extract: (msg) => {
                    const regex = /(?:запомни|не забудь|запиши)[\s,]*(?:что)?[\s,]*(.+)/i;
                    const match = msg.match(regex);
                    return match ? match[1].trim() : null;
                },
                response: (info) => `Запомнил: "${info}"`
            },
            question: {
                patterns: ['что ты знаешь', 'что помнишь', 'что знаешь обо мне', 'my info'],
                extract: (msg) => 'info_request',
                response: (userId) => {
                    const memories = this.memory.getUserMemory(userId);
                    if (Object.keys(memories).length === 0) {
                        return 'Я ещё ничего не знаю о тебе. Расскажи что-нибудь о себе!';
                    }
                    
                    let response = '**Что я знаю о тебе:**\n';
                    for (const [key, data] of Object.entries(memories)) {
                        response += `• **${key}**: ${data.value} (запомнено ${new Date(data.timestamp).toLocaleDateString('ru-RU')})\n`;
                    }
                    return response;
                }
            },
            forget: {
                patterns: ['забудь', 'удали', 'убери', 'forget', 'delete'],
                extract: (msg) => {
                    const regex = /(?:забудь|удали|убери)[\s,]*(.+)/i;
                    const match = msg.match(regex);
                    return match ? match[1].trim() : null;
                },
                response: (key, userId) => this.memory.forget(userId, key)
            }
        };
    }

    // Простой математический калькулятор
    calculateMath(expression) {
        try {
            // Извлекаем числа и оператор
            const match = expression.match(/(\d+(?:\.\d+)?)\s*([+\\-*/])\s*(\d+(?:\.\d+)?)/);
            if (!match) {
                return 'Не могу распознать математическое выражение. Формат: число оператор число (например: 5+3, 10*2)';
            }
            
            const a = parseFloat(match[1]);
            const b = parseFloat(match[3]);
            const op = match[2];
            
            let result;
            switch(op) {
                case '+': result = a + b; break;
                case '-': result = a - b; break;
                case '*': result = a * b; break;
                case '/': 
                    if (b === 0) return 'На ноль делить нельзя!';
                    result = a / b; 
                    break;
                default: return 'Неподдерживаемая операция';
            }
            
            return `${a} ${op} ${b} = ${result}`;
        } catch (error) {
            console.error('Ошибка вычисления:', error);
            return 'Ошибка в вычислениях. Проверь правильность выражения.';
        }
    }

    // Проверка на математическое выражение
    isMathExpression(message) {
        return /\d+\s*[+\\-*/]\s*\d+/.test(message);
    }

    // Обработка извлечения информации
    processExtraction(message, userId) {
        const lowerMessage = message.toLowerCase();
        
        for (const [category, rule] of Object.entries(this.extractionRules)) {
            for (const pattern of rule.patterns) {
                if (lowerMessage.includes(pattern)) {
                    const extracted = rule.extract(message);
                    
                    if (extracted === 'info_request') {
                        return rule.response(userId);
                    }
                    
                    if (extracted) {
                        switch(category) {
                            case 'name':
                                this.memory.remember(userId, 'имя', extracted);
                                return rule.response(extracted);
                                
                            case 'remember':
                                this.memory.remember(userId, 'факт', extracted);
                                return rule.response(extracted);
                                
                            case 'forget':
                                const result = rule.response(extracted, userId);
                                return result;
                        }
                    }
                }
            }
        }
        return null;
    }

    // Поиск ответа по контексту
    findContextualResponse(message, userId) {
        if (this.context.length > 0) {
            const lastInteraction = this.context[this.context.length - 1];
            
            // Если пользователь отвечает на предыдущий вопрос
            if (lastInteraction && lastInteraction.response && 
                lastInteraction.response.includes('Как дела?')) {
                if (message.length < 50) { // Не слишком длинный ответ
                    const responses = [
                        `Понятно! Рад, что у тебя "${message}"!`,
                        `Записал! "${message}" — это интересно.`,
                        `Спасибо, что поделился! "${message}"`
                    ];
                    return responses[Math.floor(Math.random() * responses.length)];
                }
            }
        }
        return null;
    }

    // Основной метод поиска ответа
    findResponse(message, username, userId = 'default') {
        const lowerMessage = message.toLowerCase();
        
        // 1. Проверяем извлечение информации
        const extractionResponse = this.processExtraction(message, userId);
        if (extractionResponse) {
            return extractionResponse;
        }
        
        // 2. Проверяем математические выражения
        if (this.isMathExpression(message)) {
            return this.calculateMath(message);
        }
        
        // 3. Проверяем контекстуальные ответы
        const contextualResponse = this.findContextualResponse(message, userId);
        if (contextualResponse) {
            return contextualResponse;
        }
        
        // 4. Проверяем, знаем ли мы имя пользователя для персонализации
        const userName = this.memory.recall(userId, 'имя');
        const personalGreeting = userName ? `, ${userName}` : '';
        
        // 5. Ищем по правилам с учетом весов
        let matchedRules = [];
        
        for (const [category, rule] of Object.entries(this.rules)) {
            for (const pattern of rule.patterns) {
                // Проверяем точное совпадение или вхождение
                if (lowerMessage.includes(pattern) || 
                   new RegExp(`\\b${pattern}\\b`).test(lowerMessage)) {
                    matchedRules.push({
                        category,
                        rule,
                        matchLength: pattern.length,
                        weight: rule.weight
                    });
                }
            }
        }
        
        // Выбираем лучшее совпадение
        if (matchedRules.length > 0) {
            // Сортируем по длине совпадения и весу
            matchedRules.sort((a, b) => {
                if (a.matchLength !== b.matchLength) {
                    return b.matchLength - a.matchLength; // Более длинное совпадение лучше
                }
                return b.weight - a.weight;
            });
            
            const bestMatch = matchedRules[0];
            const responses = bestMatch.rule.responses;
            
            if (responses.length > 0) {
                let response = responses[Math.floor(Math.random() * responses.length)];
                
                // Добавляем персонализацию если есть имя
                if (userName && (bestMatch.category === 'greetings' || bestMatch.category === 'howAreYou')) {
                    response = response.replace('!', `${personalGreeting}!`);
                }
                
                return response;
            }
        }
        
        // 6. Если ничего не нашли - генерируем ответ
        return this.generateFallbackResponse(message, userName);
    }

    // Генерация ответа, когда не знаем что сказать
    generateFallbackResponse(message, userName = '') {
        const userPart = userName ? `, ${userName}` : '';
        
        // Анализируем сообщение
        const msgLength = message.length;
        const hasQuestionMark = message.includes('?');
        
        const fallbacks = [
            'Интересный вопрос! Что ты об этом думаешь?',
            'Пока не могу ответить на этот вопрос, но я учусь!',
            'Моя база знаний ещё не содержит ответ на этот вопрос.',
            'Можешь задать другой вопрос?',
            'Давай поговорим о чём-то другом!',
            'Хм... интересно. А как бы ты ответил на этот вопрос?',
            'Сложный вопрос! Может, обсудим что-то попроще?',
            'Я ещё не научился отвечать на такие вопросы, но работаю над этим!'
        ];
        
        // Специальные ответы в зависимости от типа сообщения
        if (hasQuestionMark) {
            const questionResponses = [
                'Хороший вопрос! К сожалению, у меня нет ответа.',
                'Интересный вопрос. Мне нужно больше информации.',
                'На этот вопрос я пока не знаю ответа.',
                'Спроси что-нибудь другое!'
            ];
            return questionResponses[Math.floor(Math.random() * questionResponses.length)];
        }
        
        if (msgLength > 100) {
            return 'Длинное сообщение! Я понял, что тебе есть что сказать. Продолжай!' + userPart;
        }
        
        if (msgLength < 5) {
            return 'Коротко и ясно!' + userPart;
        }
        
        return fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }

    // Обновляем контекст диалога
    updateContext(user, message, response, userId = 'default') {
        this.context.push({
            user: user,
            userId: userId,
            message: message,
            response: response,
            timestamp: Date.now()
        });
        
        // Ограничиваем размер контекста
        if (this.context.length > this.maxContextLength) {
            this.context.shift();
        }
        
        // Обновляем состояние пользователя
        if (!this.userStates[userId]) {
            this.userStates[userId] = {
                messageCount: 0,
                lastActive: Date.now(),
                topics: []
            };
        }
        
        this.userStates[userId].messageCount++;
        this.userStates[userId].lastActive = Date.now();
        
        // Анализируем тему (очень простой анализ)
        const words = message.toLowerCase().split(' ');
        const topicWords = ['погода', 'время', 'математика', 'имя', 'помощь', 'шутка'];
        for (const word of words) {
            if (topicWords.includes(word) && !this.userStates[userId].topics.includes(word)) {
                this.userStates[userId].topics.push(word);
            }
        }
    }

    // Получение статистики
    getStats() {
        const totalUsers = Object.keys(this.memory.getAllMemories()).length;
        const totalMemories = Object.values(this.memory.getAllMemories())
            .reduce((sum, user) => sum + Object.keys(user).length, 0);
        
        return {
            totalUsers: totalUsers,
            totalMemories: totalMemories,
            totalInteractions: this.context.length,
            activeUsers: Object.keys(this.userStates).length
        };
    }
}

// ==================== ЭКСПОРТИРУЕМЫЕ ФУНКЦИИ ====================

// Создаем глобальный экземпляр AI
const ai = new LocalAI();

// Основная функция обработки сообщений
async function basicAI(message, username, userId = 'default') {
    try {
        console.log(`🤖 AI обрабатывает от ${username} (${userId}): "${message}"`);
        
        // Ищем ответ
        let response = ai.findResponse(message, username, userId);
        
        // Обновляем контекст
        ai.updateContext(username, message, response, userId);
        
        // Добавляем небольшую задержку для естественности
        await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));
        
        // Ограничиваем длину ответа
        if (response.length > 1500) {
            response = response.substring(0, 1500) + '...';
        }
        
        return response;
        
    } catch (error) {
        console.error('❌ Ошибка в AI:', error);
        return 'Произошла ошибка при обработке сообщения. Попробуй ещё раз!';
    }
}

// Функция получения статистики бота
function getAIStats() {
    return ai.getStats();
}

// Функция очистки памяти (для админских команд)
function clearMemory(userId = null) {
    if (userId) {
        // Очищаем память конкретного пользователя
        const memories = ai.memory.getAllMemories();
        if (memories[userId]) {
            delete memories[userId];
            ai.memory.saveMemory();
            return `Память пользователя ${userId} очищена`;
        }
        return `Пользователь ${userId} не найден в памяти`;
    } else {
        // Очищаем всю память
        ai.memory.memories = {};
        ai.memory.saveMemory();
        ai.context = [];
        ai.userStates = {};
        return 'Вся память и контекст очищены';
    }
}

// Функция для ручного добавления правила
function addRule(category, patterns, responses, weight = 1.0) {
    if (!ai.rules[category]) {
        ai.rules[category] = {
            patterns: Array.isArray(patterns) ? patterns : [patterns],
            responses: Array.isArray(responses) ? responses : [responses],
            weight: weight
        };
        return `Добавлено новое правило: ${category}`;
    }
    return `Правило ${category} уже существует`;
}

// Экспортируем всё
module.exports = {
    basicAI,
    getAIStats,
    clearMemory,
    addRule,
    LocalAI // Экспортируем класс для тестирования
};