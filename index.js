require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    Collection, 
    EmbedBuilder, 
    ActivityType, 
    Partials,
    REST,
    Routes,
    SlashCommandBuilder,
    ChannelType,
    PermissionFlagsBits
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageReactions,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction]
});

client.commands = new Collection();
client.activeChats = new Map();
client.userSessions = new Map();
client.parallelProcessor = null;

const ACTIVE_CHATS_FILE = path.join(__dirname, 'data/active_chats.json');
const CONTEXT_DATA_FILE = path.join(__dirname, 'data/context_data.json');

class ParallelTextProcessor {
    constructor() {
        this.contextData = new Map();
        this.loadContextData();
        this.processingQueue = [];
        this.isProcessing = false;
    }

    loadContextData() {
        try {
            if (fs.existsSync(CONTEXT_DATA_FILE)) {
                const data = fs.readFileSync(CONTEXT_DATA_FILE, 'utf8');
                const loaded = JSON.parse(data);
                this.contextData = new Map(Object.entries(loaded));
                console.log(`Загружено ${this.contextData.size} категорий контекстных данных`);
            }
        } catch {
            this.saveContextData();
        }
    }

    saveContextData() {
        try {
            fs.mkdirSync(path.dirname(CONTEXT_DATA_FILE), { recursive: true });
            const data = JSON.stringify(Object.fromEntries(this.contextData), null, 2);
            fs.writeFileSync(CONTEXT_DATA_FILE, data);
        } catch {}
    }

    addContextData(category, entries) {
        if (!this.contextData.has(category)) {
            this.contextData.set(category, []);
        }
        const current = this.contextData.get(category);
        current.push(...entries);
        this.saveContextData();
    }

    findSimilarEntries(category, query, limit = 3) {
        const data = this.contextData.get(category) || [];
        const queryLower = query.toLowerCase();
        
        return data
            .filter(entry => {
                const entryLower = entry.toLowerCase();
                return entryLower.includes(queryLower) || 
                       queryLower.includes(entryLower) ||
                       this.calculateSimilarity(entryLower, queryLower) > 0.3;
            })
            .slice(0, limit);
    }

    calculateSimilarity(str1, str2) {
        const words1 = str1.split(/\s+/);
        const words2 = str2.split(/\s+/);
        const common = words1.filter(word => words2.includes(word));
        return common.length / Math.max(words1.length, words2.length);
    }

    async generateText(category, query, userId, username) {
        const similar = this.findSimilarEntries(category, query);
        
        if (similar.length === 0) {
            const fallbackResponses = [
                `На основе вашего запроса "${query}" я сгенерировал ответ.`,
                `Я обработал ваш запрос "${query}". Вот что получилось.`,
                `Основываясь на "${query}", вот мой ответ.`
            ];
            return fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)];
        }

        const randomPatterns = [
            `На основе ${similar.length} похожих записей: ${similar.join(' ')}. В контексте: ${query}`,
            `Исходя из известных данных: ${similar.join(' ')}. По вашему запросу "${query}"`,
            `С учетом информации: ${similar.join(' ')}. Отвечаю на ваш вопрос: ${query}`,
            `Основываясь на знаниях: ${similar[0]}. Также учитывая: ${query}`,
            `Из базы знаний найдено: ${similar.length} совпадений. Формирую ответ на "${query}"`
        ];

        return randomPatterns[Math.floor(Math.random() * randomPatterns.length)];
    }

    async processBatch(requests) {
        const results = await Promise.all(
            requests.map(async (request) => {
                try {
                    const result = await this.generateText(
                        request.category, 
                        request.query, 
                        request.userId, 
                        request.username
                    );
                    return { requestId: request.id, success: true, result };
                } catch (error) {
                    return { requestId: request.id, success: false, error: error.message };
                }
            })
        );

        return results;
    }

    getStats() {
        let totalEntries = 0;
        this.contextData.forEach(entries => {
            totalEntries += entries.length;
        });

        return {
            categories: this.contextData.size,
            totalEntries: totalEntries,
            processingQueue: this.processingQueue.length
        };
    }

    clearCategory(category) {
        if (this.contextData.has(category)) {
            this.contextData.set(category, []);
            this.saveContextData();
            return `Категория "${category}" очищена`;
        }
        return `Категория "${category}" не найдена`;
    }
}

function loadActiveChats() {
    try {
        if (fs.existsSync(ACTIVE_CHATS_FILE)) {
            const data = fs.readFileSync(ACTIVE_CHATS_FILE, 'utf8');
            const loaded = JSON.parse(data);
            client.activeChats = new Map(Object.entries(loaded));
        }
    } catch {
        saveActiveChats();
    }
}

function saveActiveChats() {
    try {
        fs.mkdirSync(path.dirname(ACTIVE_CHATS_FILE), { recursive: true });
        const data = JSON.stringify(Object.fromEntries(client.activeChats), null, 2);
        fs.writeFileSync(ACTIVE_CHATS_FILE, data);
    } catch {}
}

const commands = [
    new SlashCommandBuilder()
        .setName('ai')
        .setDescription('Основные команды AI бота')
        .addSubcommand(subcommand =>
            subcommand
                .setName('help')
                .setDescription('Показать справку по командам')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('stats')
                .setDescription('Показать статистику бота')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('ping')
                .setDescription('Проверить задержку бота')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('info')
                .setDescription('Информация о боте')
        ),

    new SlashCommandBuilder()
        .setName('chat')
        .setDescription('Управление чатом с AI')
        .addSubcommand(subcommand =>
            subcommand
                .setName('start')
                .setDescription('Активировать AI в этом канале')
                .addStringOption(option =>
                    option
                        .setName('режим')
                        .setDescription('Режим работы AI')
                        .addChoices(
                            { name: 'Умный', value: 'smart' },
                            { name: 'Только упоминания', value: 'mention' },
                            { name: 'Тихий', value: 'quiet' }
                        )
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('stop')
                .setDescription('Отключить AI в этом канале')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('Показать статус AI в канале')
        ),

    new SlashCommandBuilder()
        .setName('admin')
        .setDescription('Административные команды')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('memory')
                .setDescription('Управление памятью AI')
                .addStringOption(option =>
                    option
                        .setName('действие')
                        .setDescription('Выберите действие')
                        .addChoices(
                            { name: 'Статистика памяти', value: 'stats' },
                            { name: 'Очистить категорию', value: 'clear_category' }
                        )
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName('категория')
                        .setDescription('Название категории')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('learn')
                .setDescription('Обучение AI на основе данных')
                .addStringOption(option =>
                    option
                        .setName('категория')
                        .setDescription('Категория для обучения')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName('текст')
                        .setDescription('Текст для обучения')
                        .setRequired(true)
                )
        ),

    new SlashCommandBuilder()
        .setName('ask')
        .setDescription('Задать вопрос AI')
        .addStringOption(option =>
            option
                .setName('вопрос')
                .setDescription('Ваш вопрос для AI')
                .setRequired(true)
                .setMaxLength(1000)
        )
        .addStringOption(option =>
            option
                .setName('категория')
                .setDescription('Категория запроса')
                .addChoices(
                    { name: 'Общее', value: 'general' },
                    { name: 'Техническое', value: 'technical' },
                    { name: 'Развлечения', value: 'entertainment' },
                    { name: 'Образование', value: 'education' }
                )
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('remember')
        .setDescription('Запомнить информацию')
        .addStringOption(option =>
            option
                .setName('информация')
                .setDescription('Что запомнить')
                .setRequired(true)
                .setMaxLength(500)
        )
        .addStringOption(option =>
            option
                .setName('категория')
                .setDescription('Категория информации')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('calculate')
        .setDescription('Решить математическое выражение')
        .addStringOption(option =>
            option
                .setName('выражение')
                .setDescription('Например: 2+2, 10*5, 15/3')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('batch')
        .setDescription('Параллельная обработка нескольких запросов')
        .addStringOption(option =>
            option
                .setName('запросы')
                .setDescription('Запросы через | (вертикальную черту)')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('категория')
                .setDescription('Категория запросов')
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('joke')
        .setDescription('Рассказать шутку')
];

async function registerCommands() {
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands.map(cmd => cmd.toJSON()) }
        );
    } catch {}
}

const statuses = [
    { type: ActivityType.Playing, name: 'с искусственным интеллектом' },
    { type: ActivityType.Listening, name: '/help для команд' },
    { type: ActivityType.Watching, name: 'за диалогами' },
    { type: ActivityType.Competing, name: 'в локальном AI' }
];

let statusIndex = 0;

function updateStatus() {
    const status = statuses[statusIndex];
    if (client.user) {
        client.user.setActivity(status.name, { type: status.type });
    }
    statusIndex = (statusIndex + 1) % statuses.length;
}

client.once('ready', async () => {
    console.log(`
╔══════════════════════════════════════════╗
║      Discord AI Bot запущен!             ║
╠══════════════════════════════════════════╣
║  Имя: ${client.user.tag}
║  ID: ${client.user.id}
║  Серверов: ${client.guilds.cache.size}
║  Пользователей: ${client.users.cache.size}
║  Версия: 4.0 (Параллельная обработка)
╚══════════════════════════════════════════╝
    `);
    
    loadActiveChats();
    client.parallelProcessor = new ParallelTextProcessor();
    await registerCommands();
    updateStatus();
    setInterval(updateStatus, 30000);
    
    const stats = client.parallelProcessor.getStats();
    console.log(`Контекстные данные: ${stats.categories} категорий, ${stats.totalEntries} записей`);
});

client.on('guildCreate', guild => {
    const welcomeEmbed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('Привет! Я локальный AI бот!')
        .setDescription('Я работаю полностью оффлайн! Используй /help чтобы начать')
        .addFields(
            { name: 'Параллельная обработка', value: '• /batch для обработки нескольких запросов\n• Умный поиск по контексту\n• Локальное хранение данных' },
            { name: 'Быстрый старт', value: '1. /chat start в нужном канале\n2. Пиши сообщения - я отвечу!\n3. /chat stop чтобы отключить' }
        )
        .setTimestamp()
        .setFooter({ text: 'Версия 4.0 • Параллельная обработка' });
    
    const defaultChannel = guild.systemChannel || guild.channels.cache.find(ch => 
        ch.type === ChannelType.GuildText && 
        ch.permissionsFor(guild.members.me).has(['ViewChannel', 'SendMessages'])
    );
    
    if (defaultChannel) {
        defaultChannel.send({ embeds: [welcomeEmbed] });
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    if (interaction.commandName === 'ai') {
        const subcommand = interaction.options.getSubcommand();
        switch (subcommand) {
            case 'help': await showHelp(interaction); break;
            case 'stats': await showStats(interaction); break;
            case 'ping': await showPing(interaction); break;
            case 'info': await showInfo(interaction); break;
        }
        return;
    }

    if (interaction.commandName === 'chat') {
        const subcommand = interaction.options.getSubcommand();
        switch (subcommand) {
            case 'start': await startChat(interaction); break;
            case 'stop': await stopChat(interaction); break;
            case 'status': await chatStatus(interaction); break;
        }
        return;
    }

    if (interaction.commandName === 'admin') {
        if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ 
                content: 'У вас нет прав для использования этой команды!', 
                ephemeral: true 
            });
        }
        
        const subcommand = interaction.options.getSubcommand();
        switch (subcommand) {
            case 'memory': await handleMemory(interaction); break;
            case 'learn': await handleLearn(interaction); break;
        }
        return;
    }

    if (interaction.commandName === 'ask') {
        await handleAsk(interaction);
        return;
    }

    if (interaction.commandName === 'remember') {
        await handleRemember(interaction);
        return;
    }

    if (interaction.commandName === 'calculate') {
        await handleCalculate(interaction);
        return;
    }

    if (interaction.commandName === 'batch') {
        await handleBatch(interaction);
        return;
    }

    if (interaction.commandName === 'joke') {
        await handleJoke(interaction);
        return;
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;
    
    const isActiveChat = client.activeChats.has(message.guild?.id);
    if (isActiveChat) {
        const activeChannelId = client.activeChats.get(message.guild.id);
        if (message.channel.id !== activeChannelId) return;
        await handleActiveChat(message);
        return;
    }
    
    const botMentioned = message.mentions.has(client.user);
    if (botMentioned) {
        await handleMention(message);
        return;
    }
});

async function showHelp(interaction) {
    const helpEmbed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('Помощь по AI боту')
        .setDescription('Локальный ИИ с параллельной обработкой')
        .addFields(
            {
                name: '💬 Чат с AI',
                value: '/chat start - активировать AI\n' +
                       '/chat stop - отключить AI\n' +
                       '/chat status - статус AI'
            },
            {
                name: '🧠 Взаимодействие',
                value: '/ask [вопрос] - задать вопрос\n' +
                       '/remember [инфо] - запомнить\n' +
                       '/batch - параллельная обработка\n' +
                       '/calculate - решить математику\n' +
                       '/joke - рассказать шутку'
            },
            {
                name: '⚙️ Администрирование',
                value: '/admin memory - управление памятью\n' +
                       '/admin learn - обучение AI'
            }
        )
        .setFooter({ text: `${client.user.username} • Параллельная обработка` })
        .setTimestamp();
    
    await interaction.reply({ embeds: [helpEmbed] });
}

async function showStats(interaction) {
    const stats = client.parallelProcessor.getStats();
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    
    const statsEmbed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('Статистика AI бота')
        .addFields(
            { name: 'Бот', value: `Серверов: ${client.guilds.cache.size}\nПользователей: ${client.users.cache.size}`, inline: true },
            { name: 'Аптайм', value: `${hours}ч ${minutes}м ${seconds}с`, inline: true },
            { name: 'Задержка', value: `${client.ws.ping}ms`, inline: true },
            { name: 'Контекстные данные', value: `Категорий: ${stats.categories}\nЗаписей: ${stats.totalEntries}`, inline: true },
            { name: 'Активные чаты', value: `${client.activeChats.size}`, inline: true },
            { name: 'Память', value: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`, inline: true }
        )
        .setFooter({ text: 'Локальный AI • Параллельная обработка' })
        .setTimestamp();
    
    await interaction.reply({ embeds: [statsEmbed] });
}

async function showPing(interaction) {
    const sent = await interaction.reply({ content: 'Pong!', fetchReply: true });
    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    await interaction.editReply(`Pong!\nЗадержка бота: ${latency}ms\nЗадержка Discord API: ${client.ws.ping}ms`);
}

async function showInfo(interaction) {
    const infoEmbed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('Информация о боте')
        .setDescription('Discord AI бот с параллельной обработкой')
        .addFields(
            { name: 'Технологии', value: 'Discord.js v14 • Node.js • Параллельная обработка', inline: true },
            { name: 'Версия', value: '4.0 (Параллельная обработка)', inline: true },
            { name: 'Обработка', value: 'Параллельные запросы • Локальная память • Контекстный поиск', inline: true },
            { name: 'Команды', value: '/batch для массовой обработки\n/learn для обучения\n/remember для памяти', inline: true }
        )
        .setFooter({ text: 'Параллельная обработка запросов' })
        .setTimestamp();
    
    await interaction.reply({ embeds: [infoEmbed] });
}

async function startChat(interaction) {
    const guildId = interaction.guild.id;
    const channelId = interaction.channel.id;
    const mode = interaction.options.getString('режим') || 'smart';
    
    client.activeChats.set(guildId, channelId);
    saveActiveChats();
    
    const modeDescriptions = {
        'smart': 'Умный режим: отвечаю на все сообщения',
        'mention': 'Только упоминания: отвечаю только когда меня упоминают',
        'quiet': 'Тихий режим: редко отвечаю на сообщения'
    };
    
    const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('AI активирован!')
        .setDescription(`Теперь я буду отвечать в этом канале\n\nРежим: ${modeDescriptions[mode]}`)
        .addFields(
            { name: 'Как работает', value: 'Пишите сообщения в этот канал - я буду на них отвечать!' },
            { name: 'Остановить', value: 'Используйте /chat stop чтобы отключить AI' }
        )
        .setTimestamp();
    
    await interaction.reply({ embeds: [embed] });
    
    if (!client.userSessions.has(guildId)) {
        client.userSessions.set(guildId, {});
    }
    const session = client.userSessions.get(guildId);
    session.chatMode = mode;
}

async function stopChat(interaction) {
    const guildId = interaction.guild.id;
    
    if (client.activeChats.has(guildId)) {
        client.activeChats.delete(guildId);
        saveActiveChats();
        
        const embed = new EmbedBuilder()
            .setColor(0xFFA500)
            .setTitle('AI отключен')
            .setDescription('Я больше не буду отвечать на сообщения в этом канале.')
            .setTimestamp();
        
        await interaction.reply({ embeds: [embed] });
    } else {
        await interaction.reply({ 
            content: 'AI не был активен в этом канале.',
            ephemeral: true 
        });
    }
}

async function chatStatus(interaction) {
    const guildId = interaction.guild.id;
    const isActive = client.activeChats.has(guildId);
    
    const embed = new EmbedBuilder()
        .setColor(isActive ? 0x00FF00 : 0xFF0000)
        .setTitle(isActive ? 'AI активен в этом канале' : 'AI не активен в этом канале');
    
    if (isActive) {
        const channelId = client.activeChats.get(guildId);
        const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
        
        embed.setDescription(`AI отвечает в канале: ${channel ? `<#${channel.id}>` : 'Неизвестный канал'}`);
        
        const session = client.userSessions.get(guildId) || {};
        const mode = session.chatMode || 'smart';
        const modeText = {
            'smart': 'Умный (отвечает на все сообщения)',
            'mention': 'Только упоминания',
            'quiet': 'Тихий (редкие ответы)'
        }[mode];
        
        embed.addFields(
            { name: 'Настройки', value: `Режим: ${modeText}` },
            { name: 'Управление', value: '/chat stop - отключить AI' }
        );
    } else {
        embed.setDescription('Чтобы активировать AI в этом канале, используйте /chat start');
    }
    
    await interaction.reply({ embeds: [embed] });
}

async function handleMemory(interaction) {
    const action = interaction.options.getString('действие');
    const category = interaction.options.getString('категория');
    
    await interaction.deferReply();
    
    switch (action) {
        case 'stats':
            const stats = client.parallelProcessor.getStats();
            const statsEmbed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('Статистика памяти AI')
                .addFields(
                    { name: 'Категории', value: `${stats.categories}`, inline: true },
                    { name: 'Записи', value: `${stats.totalEntries}`, inline: true },
                    { name: 'Очередь', value: `${stats.processingQueue}`, inline: true }
                )
                .setFooter({ text: 'Админ панель • Локальная память' })
                .setTimestamp();
            await interaction.editReply({ embeds: [statsEmbed] });
            break;
            
        case 'clear_category':
            if (!category) {
                await interaction.editReply('Укажите категорию: /admin memory clear_category категория:название');
                return;
            }
            
            const result = client.parallelProcessor.clearCategory(category);
            await interaction.editReply(result);
            break;
    }
}

async function handleLearn(interaction) {
    const category = interaction.options.getString('категория');
    const text = interaction.options.getString('текст');
    
    await interaction.deferReply();
    
    client.parallelProcessor.addContextData(category, [text]);
    
    const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('Обучение завершено')
        .setDescription(`Данные добавлены в категорию "${category}"`)
        .addFields(
            { name: 'Текст', value: text.length > 500 ? text.substring(0, 497) + '...' : text }
        )
        .setTimestamp();
    
    await interaction.editReply({ embeds: [embed] });
}

async function handleAsk(interaction) {
    const question = interaction.options.getString('вопрос');
    const category = interaction.options.getString('категория') || 'general';
    
    await interaction.deferReply();
    
    try {
        const response = await client.parallelProcessor.generateText(
            category, 
            question, 
            interaction.user.id, 
            interaction.user.username
        );
        
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('Ответ AI')
            .addFields(
                { name: 'Вопрос', value: question.length > 1000 ? question.substring(0, 997) + '...' : question },
                { name: 'Ответ', value: response.length > 1000 ? response.substring(0, 997) + '...' : response }
            )
            .setFooter({ text: `Категория: ${category} • Запрос от ${interaction.user.username}` })
            .setTimestamp();
        
        await interaction.editReply({ embeds: [embed] });
    } catch {
        await interaction.editReply('Произошла ошибка при обработке вопроса. Попробуйте ещё раз.');
    }
}

async function handleRemember(interaction) {
    const info = interaction.options.getString('информация');
    const category = interaction.options.getString('категория');
    
    client.parallelProcessor.addContextData(category, [info]);
    
    const responses = [
        `Я запомнила: "${info}"`,
        `Запомнила! "${info}" теперь сохранено.`,
        `Хорошо, я запомнила что: "${info}"`,
        `Уже запомнила! "${info}" - добавлено.`
    ];
    
    const randomResponse = responses[Math.floor(Math.random() * responses.length)];
    
    const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('Информация запомнена')
        .setDescription(randomResponse)
        .addFields(
            { name: 'Категория', value: category },
            { name: 'Что запомнил', value: info.length > 500 ? info.substring(0, 497) + '...' : info }
        )
        .setTimestamp();
    
    await interaction.reply({ embeds: [embed] });
}

async function handleCalculate(interaction) {
    const expression = interaction.options.getString('выражение');
    
    let result;
    try {
        result = eval(expression.replace(/[^0-9+\-*/().]/g, ''));
        if (typeof result !== 'number') throw new Error();
    } catch {
        result = 'Не удалось вычислить выражение';
    }
    
    const embed = new EmbedBuilder()
        .setColor(0xFFD700)
        .setTitle('Результат вычисления')
        .addFields(
            { name: 'Выражение', value: `\`\`\`${expression}\`\`\`` },
            { name: 'Результат', value: `\`\`\`${result}\`\`\`` }
        )
        .setTimestamp();
    
    await interaction.reply({ embeds: [embed] });
}

async function handleBatch(interaction) {
    const queriesText = interaction.options.getString('запросы');
    const category = interaction.options.getString('категория') || 'general';
    
    await interaction.deferReply();
    
    const queries = queriesText.split('|').map(q => q.trim()).filter(q => q.length > 0);
    
    if (queries.length === 0) {
        await interaction.editReply('Укажите запросы через | (вертикальную черту)');
        return;
    }
    
    if (queries.length > 10) {
        await interaction.editReply('Максимум 10 запросов за раз');
        return;
    }
    
    const requests = queries.map((query, index) => ({
        id: `${interaction.id}-${index}`,
        query: query,
        category: category,
        userId: interaction.user.id,
        username: interaction.user.username
    }));
    
    const startTime = Date.now();
    const results = await client.parallelProcessor.processBatch(requests);
    const processingTime = Date.now() - startTime;
    
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('Параллельная обработка завершена')
        .setDescription(`Обработано ${queries.length} запросов за ${processingTime}мс`)
        .addFields(
            { name: 'Успешно', value: `${successful.length}`, inline: true },
            { name: 'С ошибками', value: `${failed.length}`, inline: true },
            { name: 'Категория', value: category, inline: true },
            { name: 'Среднее время', value: `${(processingTime / queries.length).toFixed(0)}мс/запрос`, inline: true }
        );
    
    if (successful.length > 0) {
        const resultsText = successful.slice(0, 3).map((r, i) => {
            const query = queries[i];
            const response = r.result.length > 100 ? r.result.substring(0, 97) + '...' : r.result;
            return `${i + 1}. "${query}" → ${response}`;
        }).join('\n');
        
        if (successful.length > 3) {
            embed.addFields({ 
                name: 'Первые 3 результата', 
                value: resultsText + `\n... и еще ${successful.length - 3} результатов`
            });
        } else {
            embed.addFields({ name: 'Результаты', value: resultsText });
        }
    }
    
    await interaction.editReply({ embeds: [embed] });
}

async function handleJoke(interaction) {
    const jokes = [
        "Почему программист всегда мокрый? Потому что он постоянно в бассейне кода!",
        "Что говорит один байт другому? Мы встретимся на контроллере!",
        "Почему JavaScript разработчик не мог найти работу? Потому что он не проходил интервью!",
        "Сколько нужно программистов, чтобы вкрутить лампочку? Ни одного, это аппаратная проблема!",
        "Почему Python программисты такие крутые? Потому что у них есть змеиный шарм!"
    ];
    
    const randomJoke = jokes[Math.floor(Math.random() * jokes.length)];
    
    const embed = new EmbedBuilder()
        .setColor(0xFF69B4)
        .setTitle('Шутка от AI')
        .setDescription(randomJoke)
        .setTimestamp();
    
    await interaction.reply({ embeds: [embed] });
}

async function handleActiveChat(message) {
    try {
        await message.channel.sendTyping();
        
        const guildId = message.guild.id;
        const session = client.userSessions.get(guildId) || {};
        const mode = session.chatMode || 'smart';
        
        let shouldRespond = true;
        
        if (mode === 'mention') {
            shouldRespond = message.mentions.has(client.user);
        } else if (mode === 'quiet') {
            shouldRespond = Math.random() < 0.3;
        }
        
        if (!shouldRespond) return;
        
        const delay = mode === 'quiet' ? 2000 + Math.random() * 2000 : 800 + Math.random() * 1200;
        await new Promise(resolve => setTimeout(resolve, delay));
        
        const response = await client.parallelProcessor.generateText(
            'general',
            message.content,
            message.author.id,
            message.author.username
        );
        
        if (response && response.trim()) {
            await message.reply(response);
        }
        
    } catch {}
}

async function handleMention(message) {
    try {
        await message.channel.sendTyping();
        
        const userMessage = message.content.replace(`<@${client.user.id}>`, '').trim();
        
        if (!userMessage) {
            await message.reply('Привет! Чем могу помочь? Используй /help для списка команд!');
            return;
        }
        
        await new Promise(resolve => setTimeout(resolve, 600 + Math.random() * 800));
        
        const response = await client.parallelProcessor.generateText(
            'general',
            userMessage,
            message.author.id,
            message.author.username
        );
        
        await message.reply(response);
        
    } catch {}
}

process.on('unhandledRejection', error => {
    console.error('Необработанное отклонение промиса:', error);
});

process.on('uncaughtException', error => {
    console.error('Необработанное исключение:', error);
});

process.on('SIGINT', () => {
    console.log('Останавливаю бота...');
    saveActiveChats();
    if (client.parallelProcessor) {
        client.parallelProcessor.saveContextData();
    }
    client.destroy();
    console.log('Бот остановлен, данные сохранены');
    process.exit(0);
});

if (!process.env.DISCORD_TOKEN) {
    console.error('Ошибка: DISCORD_TOKEN не найден в .env файле!');
    console.log('Создайте файл .env с содержимым:');
    console.log('DISCORD_TOKEN=ваш_токен_бота');
    process.exit(1);
}

client.login(process.env.DISCORD_TOKEN)
    .then(() => {
        console.log('Авторизация прошла успешно!');
    })
    .catch(error => {
        console.error('Ошибка авторизации:', error);
        process.exit(1);
    });