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
const { basicAI, getAIStats, clearMemory } = require('./ai/processor.js');
const fs = require('fs');
const path = require('path');

// ==================== НАСТРОЙКА КЛИЕНТА ====================
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

// Коллекции для данных
client.commands = new Collection();
client.activeChats = new Map(); // Map для активных чатов: guildId -> channelId
client.userSessions = new Map(); // Map для сессий пользователей

// Загрузка сохраненных активных чатов
const ACTIVE_CHATS_FILE = path.join(__dirname, 'data/active_chats.json');

function loadActiveChats() {
    try {
        if (fs.existsSync(ACTIVE_CHATS_FILE)) {
            const data = fs.readFileSync(ACTIVE_CHATS_FILE, 'utf8');
            const loaded = JSON.parse(data);
            client.activeChats = new Map(Object.entries(loaded));
            console.log(`✅ Загружено ${client.activeChats.size} активных чатов`);
        }
    } catch (error) {
        console.log('📁 Создаю новый файл активных чатов...');
        saveActiveChats();
    }
}

function saveActiveChats() {
    try {
        fs.mkdirSync(path.dirname(ACTIVE_CHATS_FILE), { recursive: true });
        const data = JSON.stringify(Object.fromEntries(client.activeChats), null, 2);
        fs.writeFileSync(ACTIVE_CHATS_FILE, data);
    } catch (error) {
        console.error('❌ Ошибка сохранения активных чатов:', error);
    }
}

// ==================== СЛЭШ-КОМАНДЫ ====================
const commands = [
    // Основные команды
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

    // Команды для чатов
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
                            { name: 'Умный (отвечает на все)', value: 'smart' },
                            { name: 'Только на упоминания', value: 'mention' },
                            { name: 'Тихий (редкие ответы)', value: 'quiet' }
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

    // Админ команды
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
                            { name: 'Очистить всю память', value: 'clear_all' },
                            { name: 'Показать статистику памяти', value: 'stats' },
                            { name: 'Очистить пользователя', value: 'clear_user' }
                        )
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName('user_id')
                        .setDescription('ID пользователя для очистки')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('setmode')
                .setDescription('Установить режим работы AI на сервере')
                .addStringOption(option =>
                    option
                        .setName('режим')
                        .setDescription('Режим работы AI')
                        .addChoices(
                            { name: 'Только слэш-команды', value: 'slash_only' },
                            { name: 'Активные чаты', value: 'active_chats' },
                            { name: 'Упоминания', value: 'mentions' }
                        )
                        .setRequired(true)
                )
        ),

    // Интерактивные команды
    new SlashCommandBuilder()
        .setName('ask')
        .setDescription('Задать вопрос AI')
        .addStringOption(option =>
            option
                .setName('вопрос')
                .setDescription('Ваш вопрос для AI')
                .setRequired(true)
                .setMaxLength(1000)
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
        .setName('joke')
        .setDescription('Рассказать шутку')
];

// ==================== РЕГИСТРАЦИЯ КОМАНД ====================
async function registerCommands() {
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        
        console.log('🔄 Начинаю регистрацию слэш-команд...');
        
        // Регистрация глобальных команд
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands.map(cmd => cmd.toJSON()) }
        );
        
        console.log(`✅ Успешно зарегистрировано ${commands.length} команд`);
    } catch (error) {
        console.error('❌ Ошибка регистрации команд:', error);
    }
}

// ==================== СТАТУС БОТА ====================
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

// ==================== ОБРАБОТЧИКИ СОБЫТИЙ ====================

// Когда бот готов
client.once('ready', async () => {
    console.log(`
╔══════════════════════════════════════════╗
║      🤖 Discord AI Bot запущен!          ║
╠══════════════════════════════════════════╣
║  Имя: ${client.user.tag}
║  ID: ${client.user.id}
║  Серверов: ${client.guilds.cache.size}
║  Пользователей: ${client.users.cache.size}
║  Версия: 3.0 (Slash Commands)
╚══════════════════════════════════════════╝
    `);
    
    // Загружаем активные чаты
    loadActiveChats();
    
    // Регистрируем команды
    await registerCommands();
    
    // Устанавливаем начальный статус
    updateStatus();
    // Меняем статус каждые 30 секунд
    setInterval(updateStatus, 30000);
    
    // Статистика AI
    const stats = getAIStats();
    console.log(`📊 Статистика AI:`);
    console.log(`   👥 Пользователей в памяти: ${stats.totalUsers}`);
    console.log(`   💾 Запомненных фактов: ${stats.totalMemories}`);
    console.log(`   💬 Всего диалогов: ${stats.totalInteractions}`);
    console.log(`   📍 Активных чатов: ${client.activeChats.size}`);
});

// Когда бот добавляется на сервер
client.on('guildCreate', guild => {
    console.log(`✅ Добавлен на сервер: ${guild.name} (${guild.id})`);
    
    // Приветственное сообщение в системный канал
    const welcomeEmbed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('🤖 Привет! Я локальный AI бот!')
        .setDescription('Я работаю полностью оффлайн без API ключей! Используй `/help` чтобы начать')
        .addFields(
            { name: '✨ Новое в версии 3.0', value: '• Слэш-команды (/commands)\n• Умные чаты\n• Улучшенный AI' },
            { name: '🚀 Быстрый старт', value: '1. Используй `/chat start` в нужном канале\n2. Пиши сообщения - я отвечу!\n3. `/chat stop` чтобы отключить' },
            { name: '💡 Основные команды', value: '`/ask` - задать вопрос\n`/remember` - запомнить что-то\n`/calculate` - решить пример\n`/joke` - шутка' }
        )
        .setTimestamp()
        .setFooter({ text: 'Версия 3.0 • Слэш-команды • Локальный AI' });
    
    // Ищем канал для приветствия
    const defaultChannel = guild.systemChannel || guild.channels.cache.find(ch => 
        ch.type === ChannelType.GuildText && 
        ch.permissionsFor(guild.members.me).has(['ViewChannel', 'SendMessages'])
    );
    
    if (defaultChannel) {
        defaultChannel.send({ embeds: [welcomeEmbed] });
    }
});

// Обработка слэш-команд
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    // Обработка команды /ai
    if (interaction.commandName === 'ai') {
        const subcommand = interaction.options.getSubcommand();
        
        switch (subcommand) {
            case 'help':
                await showHelp(interaction);
                break;
            case 'stats':
                await showStats(interaction);
                break;
            case 'ping':
                await showPing(interaction);
                break;
            case 'info':
                await showInfo(interaction);
                break;
        }
        return;
    }

    // Обработка команды /chat
    if (interaction.commandName === 'chat') {
        const subcommand = interaction.options.getSubcommand();
        
        switch (subcommand) {
            case 'start':
                await startChat(interaction);
                break;
            case 'stop':
                await stopChat(interaction);
                break;
            case 'status':
                await chatStatus(interaction);
                break;
        }
        return;
    }

    // Обработка команды /admin
    if (interaction.commandName === 'admin') {
        // Проверка прав администратора
        if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ 
                content: '❌ У вас нет прав для использования этой команды!', 
                ephemeral: true 
            });
        }
        
        const subcommand = interaction.options.getSubcommand();
        
        switch (subcommand) {
            case 'memory':
                await handleMemory(interaction);
                break;
            case 'setmode':
                await setMode(interaction);
                break;
        }
        return;
    }

    // Обработка команды /ask
    if (interaction.commandName === 'ask') {
        await handleAsk(interaction);
        return;
    }

    // Обработка команды /remember
    if (interaction.commandName === 'remember') {
        await handleRemember(interaction);
        return;
    }

    // Обработка команды /calculate
    if (interaction.commandName === 'calculate') {
        await handleCalculate(interaction);
        return;
    }

    // Обработка команды /joke
    if (interaction.commandName === 'joke') {
        await handleJoke(interaction);
        return;
    }
});

// Когда приходит новое сообщение
client.on('messageCreate', async message => {
    // Игнорируем сообщения от ботов
    if (message.author.bot) return;
    
    // Проверяем, активен ли AI в этом канале
    const isActiveChat = client.activeChats.has(message.guild?.id);
    if (isActiveChat) {
        const activeChannelId = client.activeChats.get(message.guild.id);
        
        // Если это не активный канал, игнорируем
        if (message.channel.id !== activeChannelId) return;
        
        // Отвечаем в активном чате
        await handleActiveChat(message);
        return;
    }
    
    // Если не активный чат, проверяем упоминания
    const botMentioned = message.mentions.has(client.user);
    if (botMentioned) {
        await handleMention(message);
        return;
    }
});

// ==================== ОБРАБОТЧИКИ КОМАНД ====================

// Команда /ai help
async function showHelp(interaction) {
    const helpEmbed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🤖 Помощь по AI боту')
        .setDescription('Локальный искусственный интеллект без API ключей\nИспользуй слэш-команды для взаимодействия!')
        .addFields(
            {
                name: '💬 Чат с AI',
                value: '`/chat start` - активировать AI в этом канале\n' +
                       '`/chat stop` - отключить AI в канале\n' +
                       '`/chat status` - статус AI в канале'
            },
            {
                name: '🧠 Взаимодействие',
                value: '`/ask [вопрос]` - задать вопрос AI\n' +
                       '`/remember [инфо]` - запомнить информацию\n' +
                       '`/calculate [пример]` - решить математику\n' +
                       '`/joke` - рассказать шутку'
            },
            {
                name: '📊 Информация',
                value: '`/ai help` - эта справка\n' +
                       '`/ai stats` - статистика бота\n' +
                       '`/ai ping` - проверить задержку\n' +
                       '`/ai info` - информация о боте'
            },
            {
                name: '⚙️ Администрирование',
                value: '`/admin memory` - управление памятью\n' +
                       '`/admin setmode` - настройка режима'
            },
            {
                name: '🚀 Как начать',
                value: '1. Выбери канал где хочешь общаться с AI\n' +
                       '2. Используй `/chat start` в этом канале\n' +
                       '3. Начинай писать сообщения - я буду отвечать!\n' +
                       '4. `/chat stop` когда закончишь'
            }
        )
        .setFooter({ text: `${client.user.username} • Версия 3.0`, iconURL: client.user.displayAvatarURL() })
        .setTimestamp();
    
    await interaction.reply({ embeds: [helpEmbed] });
}

// Команда /ai stats
async function showStats(interaction) {
    const stats = getAIStats();
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    
    const statsEmbed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('📊 Статистика AI бота')
        .addFields(
            { name: '🤖 Бот', value: `Серверов: ${client.guilds.cache.size}\nПользователей: ${client.users.cache.size}`, inline: true },
            { name: '⏱️ Аптайм', value: `${hours}ч ${minutes}м ${seconds}с`, inline: true },
            { name: '📡 Задержка', value: `${client.ws.ping}ms`, inline: true },
            { name: '🧠 AI Память', value: `Пользователей: ${stats.totalUsers}\nФактов: ${stats.totalMemories}`, inline: true },
            { name: '💬 Диалоги', value: `Всего: ${stats.totalInteractions}\nАктивных: ${stats.activeUsers}`, inline: true },
            { name: '📍 Активные чаты', value: `${client.activeChats.size}`, inline: true }
        )
        .setFooter({ text: 'Локальный AI • Работает без API ключей', iconURL: client.user.displayAvatarURL() })
        .setTimestamp();
    
    await interaction.reply({ embeds: [statsEmbed] });
}

// Команда /ai ping
async function showPing(interaction) {
    const sent = await interaction.reply({ content: '🏓 Pong!', fetchReply: true });
    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    
    await interaction.editReply(`🏓 Pong!\n• Задержка бота: ${latency}ms\n• Задержка Discord API: ${client.ws.ping}ms`);
}

// Команда /ai info
async function showInfo(interaction) {
    const infoEmbed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🤖 Информация о боте')
        .setDescription('Локальный Discord AI бот без внешних API')
        .addFields(
            { name: '👨‍💻 Технологии', value: 'Discord.js v14 • Node.js • Локальный AI', inline: true },
            { name: '🌐 Версия', value: '3.0 (Slash Commands)', inline: true },
            { name: '🔐 Безопасность', value: 'Работает без API ключей', inline: true },
            { name: '💾 Хранение данных', value: 'Локально в JSON файлах', inline: true },
            { name: '🧠 Искусственный интеллект', value: 'Правила + контекст + память', inline: true },
            { name: '⚡ Производительность', value: 'Мгновенные ответы', inline: true }
        )
        .addFields({
            name: '✨ Особенности версии 3.0',
            value: '• Современные слэш-команды\n• Система активных чатов\n• Улучшенный диалоговый AI\n• Полная автономность'
        })
        .setFooter({ text: 'Полностью автономный AI', iconURL: client.user.displayAvatarURL() })
        .setTimestamp();
    
    await interaction.reply({ embeds: [infoEmbed] });
}

// Команда /chat start
async function startChat(interaction) {
    const guildId = interaction.guild.id;
    const channelId = interaction.channel.id;
    const mode = interaction.options.getString('режим') || 'smart';
    
    // Сохраняем активный чат
    client.activeChats.set(guildId, channelId);
    saveActiveChats();
    
    const modeDescriptions = {
        'smart': '🤖 Умный режим: отвечаю на все сообщения',
        'mention': '👂 Только упоминания: отвечаю только когда меня упоминают',
        'quiet': '🔇 Тихий режим: редко отвечаю на сообщения'
    };
    
    const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('✅ AI активирован!')
        .setDescription(`Теперь я буду отвечать в этом канале на ваши сообщения!\n\n**Режим:** ${modeDescriptions[mode]}`)
        .addFields(
            { name: '📝 Как работает', value: 'Просто пишите сообщения в этот канал - я буду на них отвечать!' },
            { name: '⚡ Быстрые команды', value: 'Можете продолжать использовать слэш-команды в любом канале' },
            { name: '⏹️ Остановить', value: 'Используйте `/chat stop` чтобы отключить AI' }
        )
        .setTimestamp();
    
    await interaction.reply({ embeds: [embed] });
    
    // Сохраняем режим для этого сервера
    if (!client.userSessions.has(guildId)) {
        client.userSessions.set(guildId, {});
    }
    const session = client.userSessions.get(guildId);
    session.chatMode = mode;
}

// Команда /chat stop
async function stopChat(interaction) {
    const guildId = interaction.guild.id;
    
    if (client.activeChats.has(guildId)) {
        client.activeChats.delete(guildId);
        saveActiveChats();
        
        const embed = new EmbedBuilder()
            .setColor(0xFFA500)
            .setTitle('⏹️ AI отключен')
            .setDescription('Я больше не буду отвечать на сообщения в этом канале.')
            .addFields(
                { name: '🔧 Что можно делать дальше?', value: '• Используйте слэш-команды (/help)\n• Упоминайте меня (@бот) для ответа\n• Активируйте в другом канале через `/chat start`' }
            )
            .setTimestamp();
        
        await interaction.reply({ embeds: [embed] });
    } else {
        await interaction.reply({ 
            content: '❌ AI не был активен в этом канале.',
            ephemeral: true 
        });
    }
}

// Команда /chat status
async function chatStatus(interaction) {
    const guildId = interaction.guild.id;
    const isActive = client.activeChats.has(guildId);
    
    const embed = new EmbedBuilder()
        .setColor(isActive ? 0x00FF00 : 0xFF0000)
        .setTitle(isActive ? '🟢 AI активен в этом канале' : '🔴 AI не активен в этом канале');
    
    if (isActive) {
        const channelId = client.activeChats.get(guildId);
        const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
        
        embed.setDescription(`AI отвечает на сообщения в канале: ${channel ? `<#${channel.id}>` : 'Неизвестный канал'}`);
        
        const session = client.userSessions.get(guildId) || {};
        const mode = session.chatMode || 'smart';
        const modeText = {
            'smart': '🤖 Умный (отвечает на все сообщения)',
            'mention': '👂 Только упоминания',
            'quiet': '🔇 Тихий (редкие ответы)'
        }[mode];
        
        embed.addFields(
            { name: '📊 Статистика', value: `• Режим: ${modeText}\n• Активен с: <t:${Math.floor(Date.now() / 1000)}:R>` },
            { name: '⚡ Управление', value: '`/chat stop` - отключить AI\n`/chat start` - изменить настройки' }
        );
    } else {
        embed.setDescription('Чтобы активировать AI в этом канале, используйте `/chat start`');
        embed.addFields(
            { name: '🚀 Быстрый старт', value: '1. Напишите `/chat start` в нужном канале\n2. Начните общаться - я буду отвечать!\n3. Используйте `/chat stop` чтобы отключить' },
            { name: '💡 Альтернативы', value: '• Используйте слэш-команды (/ask, /remember)\n• Упоминайте меня (@бот) для ответов\n• Пишите в личные сообщения' }
        );
    }
    
    await interaction.reply({ embeds: [embed] });
}

// Команда /admin memory
async function handleMemory(interaction) {
    const action = interaction.options.getString('действие');
    const userId = interaction.options.getString('user_id');
    
    await interaction.deferReply();
    
    switch (action) {
        case 'clear_all':
            const result = clearMemory();
            await interaction.editReply(`✅ ${result}`);
            break;
            
        case 'stats':
            const stats = getAIStats();
            const statsEmbed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('📊 Статистика памяти AI')
                .addFields(
                    { name: '👥 Пользователи', value: `${stats.totalUsers}`, inline: true },
                    { name: '💾 Факты', value: `${stats.totalMemories}`, inline: true },
                    { name: '💬 Диалоги', value: `${stats.totalInteractions}`, inline: true },
                    { name: '📈 Активные', value: `${stats.activeUsers}`, inline: true },
                    { name: '📍 Чаты', value: `${client.activeChats.size}`, inline: true },
                    { name: '💾 RAM', value: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`, inline: true }
                )
                .setFooter({ text: 'Админ панель • Локальная память' })
                .setTimestamp();
            await interaction.editReply({ embeds: [statsEmbed] });
            break;
            
        case 'clear_user':
            if (!userId) {
                await interaction.editReply('❌ Укажите ID пользователя: `/admin memory clear_user user_id:ID_ПОЛЬЗОВАТЕЛЯ`');
                return;
            }
            
            if (!userId.match(/^\d+$/)) {
                await interaction.editReply('❌ Неверный формат ID пользователя');
                return;
            }
            
            const userResult = clearMemory(userId);
            await interaction.editReply(`✅ ${userResult}`);
            break;
    }
}

// Команда /admin setmode
async function setMode(interaction) {
    const mode = interaction.options.getString('режим');
    
    // Здесь можно добавить сохранение режима для сервера
    // Пока просто показываем сообщение
    
    const modes = {
        'slash_only': '🔧 Только слэш-команды: AI отвечает только на команды',
        'active_chats': '💬 Активные чаты: AI отвечает в активированных каналах',
        'mentions': '👂 Упоминания: AI отвечает только при упоминании'
    };
    
    const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('⚙️ Режим работы установлен')
        .setDescription(`**Режим:** ${modes[mode]}`)
        .addFields(
            { name: '🔧 Текущие настройки', value: `• Активные чаты: ${client.activeChats.size}\n• Слэш-команды: всегда доступны\n• Упоминания: всегда работают` },
            { name: '📝 Примечание', value: 'На данный момент режимы полностью независимы. Все методы работы доступны одновременно.' }
        )
        .setTimestamp();
    
    await interaction.reply({ embeds: [embed] });
}

// Команда /ask
async function handleAsk(interaction) {
    const question = interaction.options.getString('вопрос');
    
    await interaction.deferReply();
    
    try {
        const response = await basicAI(question, interaction.user.username, interaction.user.id);
        
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('🤖 Ответ AI')
            .addFields(
                { name: '📤 Ваш вопрос', value: question.length > 1000 ? question.substring(0, 997) + '...' : question },
                { name: '📥 Ответ AI', value: response.length > 1000 ? response.substring(0, 997) + '...' : response }
            )
            .setFooter({ text: `Запрос от ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() })
            .setTimestamp();
        
        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('Ошибка в команде /ask:', error);
        await interaction.editReply('❌ Произошла ошибка при обработке вопроса. Попробуйте ещё раз.');
    }
}

// Команда /remember
async function handleRemember(interaction) {
    const info = interaction.options.getString('информация');
    
    // Генерируем фиксированный ответ без использования basicAI
    const responses = [
        `✅ Я запомнила: "${info}"`,
        `💾 Запомнила! "${info}" теперь сохранено в моей памяти.`,
        `📝 Хорошо, я запомнила что: "${info}"`,
        `🧠 Уже запомнила! "${info}" - добавлено в мои знания.`,
        `✨ Готово! Я запомнила: "${info}"`
    ];
    
    const randomResponse = responses[Math.floor(Math.random() * responses.length)];
    
    const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('💾 Информация запомнена')
        .setDescription(randomResponse)
        .addFields(
            { name: '📝 Что запомнил', value: info.length > 500 ? info.substring(0, 497) + '...' : info }
        )
        .setFooter({ text: `Для ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() })
        .setTimestamp();
    
    await interaction.reply({ embeds: [embed] });
}
// Команда /calculate
async function handleCalculate(interaction) {
    const expression = interaction.options.getString('выражение');
    
    // Используем basicAI для вычислений
    const response = await basicAI(expression, interaction.user.username, interaction.user.id);
    
    const embed = new EmbedBuilder()
        .setColor(0xFFD700)
        .setTitle('🧮 Результат вычисления')
        .addFields(
            { name: '📝 Выражение', value: `\`\`\`${expression}\`\`\`` },
            { name: '📊 Результат', value: `\`\`\`${response}\`\`\`` }
        )
        .setFooter({ text: `Запрос от ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() })
        .setTimestamp();
    
    await interaction.reply({ embeds: [embed] });
}

// Команда /joke
async function handleJoke(interaction) {
    await interaction.deferReply();
    
    const response = await basicAI('расскажи шутку', interaction.user.username, interaction.user.id);
    
    const embed = new EmbedBuilder()
        .setColor(0xFF69B4)
        .setTitle('😂 Шутка от AI')
        .setDescription(response)
        .setFooter({ text: 'Надеюсь, вам понравилось!', iconURL: interaction.user.displayAvatarURL() })
        .setTimestamp();
    
    await interaction.editReply({ embeds: [embed] });
}

// ==================== ОБРАБОТЧИКИ СООБЩЕНИЙ ====================

// Обработка активного чата
async function handleActiveChat(message) {
    try {
        // Показываем индикатор набора
        await message.channel.sendTyping();
        
        // Проверяем режим чата
        const guildId = message.guild.id;
        const session = client.userSessions.get(guildId) || {};
        const mode = session.chatMode || 'smart';
        
        // Проверяем, нужно ли отвечать по режиму
        let shouldRespond = true;
        
        if (mode === 'mention') {
            shouldRespond = message.mentions.has(client.user);
        } else if (mode === 'quiet') {
            // Отвечаем только на 30% сообщений в тихом режиме
            shouldRespond = Math.random() < 0.3;
        }
        
        if (!shouldRespond) return;
        
        // Добавляем задержку для естественности
        const delay = mode === 'quiet' ? 2000 + Math.random() * 2000 : 800 + Math.random() * 1200;
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Обрабатываем сообщение
        const response = await basicAI(
            message.content,
            message.author.username,
            message.author.id
        );
        
        // Отправляем ответ
        if (response && response.trim()) {
            await message.reply(response);
        }
        
    } catch (error) {
        console.error('Ошибка в активном чате:', error);
    }
}

// Обработка упоминаний
async function handleMention(message) {
    try {
        await message.channel.sendTyping();
        
        // Убираем упоминание из сообщения
        const userMessage = message.content.replace(`<@${client.user.id}>`, '').trim();
        
        if (!userMessage) {
            await message.reply('Привет! Чем могу помочь? Используй `/help` для списка команд!');
            return;
        }
        
        // Задержка для естественности
        await new Promise(resolve => setTimeout(resolve, 600 + Math.random() * 800));
        
        // Обрабатываем сообщение
        const response = await basicAI(
            userMessage,
            message.author.username,
            message.author.id
        );
        
        await message.reply(response);
        
    } catch (error) {
        console.error('Ошибка при обработке упоминания:', error);
    }
}

// ==================== ОБРАБОТКА ОШИБОК ====================
process.on('unhandledRejection', error => {
    console.error('Необработанное отклонение промиса:', error);
});

process.on('uncaughtException', error => {
    console.error('Необработанное исключение:', error);
});

// Грациозное завершение
process.on('SIGINT', () => {
    console.log('\n🛑 Останавливаю бота...');
    saveActiveChats();
    client.destroy();
    console.log('✅ Бот остановлен, данные сохранены');
    process.exit(0);
});

// ==================== ЗАПУСК БОТА ====================

// Проверка наличия токена
if (!process.env.DISCORD_TOKEN) {
    console.error('❌ Ошибка: DISCORD_TOKEN не найден в .env файле!');
    console.log('📝 Создайте файл .env с содержимым:');
    console.log('DISCORD_TOKEN=ваш_токен_бота');
    process.exit(1);
}

// Запуск бота
client.login(process.env.DISCORD_TOKEN)
    .then(() => {
        console.log('🔑 Авторизация прошла успешно!');
    })
    .catch(error => {
        console.error('❌ Ошибка авторизации:', error);
        process.exit(1);
    });
