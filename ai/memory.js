const fs = require('fs').promises;
const path = require('path');

class MemorySystem {
    constructor() {
        this.memoryPath = path.join(__dirname, '../data/memory.json');
        this.memories = {};
        this.loadMemory();
    }

    async loadMemory() {
        try {
            const data = await fs.readFile(this.memoryPath, 'utf8');
            this.memories = JSON.parse(data);
        } catch (error) {
            this.memories = {};
            await this.saveMemory();
        }
    }

    async saveMemory() {
        await fs.mkdir(path.dirname(this.memoryPath), { recursive: true });
        await fs.writeFile(this.memoryPath, JSON.stringify(this.memories, null, 2));
    }

    // Попытка мозгов
    remember(userId, key, value) {
        if (!this.memories[userId]) {
            this.memories[userId] = {};
        }
        this.memories[userId][key] = {
            value: value,
            timestamp: Date.now()
        };
        this.saveMemory();
    }

    // Ищем информацию уже из мозгов
    recall(userId, key) {
        if (this.memories[userId] && this.memories[userId][key]) {
            return this.memories[userId][key].value;
        }
        return null;
    }

    // получаем информацию из дс\мозгов совместно
    getUserMemory(userId) {
        return this.memories[userId] || {};
    }
}

module.exports = { MemorySystem };