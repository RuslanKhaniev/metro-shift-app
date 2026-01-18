/**
 * calc_logic.js
 * Версия 5.0 (Fix): Добавлена передача строкового времени (startTime, endTime)
 * для совместимости с новым калькулятором.
 */

const SHIFT_TYPES = {
    WORK: 'WORK',
    SICK: 'SICK',
    VACATION: 'VACATION',
    DONOR: 'DONOR',
    TRAINING: 'TRAINING',
    MED_CHECK: 'MED_CHECK',
    RESERVE: 'RESERVE',
    OTHER: 'OTHER'
};

const Logic = {
    holidaysData: {
        fixed: ["01-01", "01-02", "01-03", "01-04", "01-05", "01-06", "01-07", "01-08", "02-23", "03-08", "05-01", "05-09", "06-12", "11-04"],
        workOnWeekend: ["2024-04-27", "2024-11-02", "2024-12-28", "2025-11-01"],
        restOnWorkday: ["2024-04-29", "2024-04-30", "2024-05-10", "2024-12-30", "2024-12-31", "2025-05-02", "2025-05-08", "2025-06-13", "2025-11-03", "2025-12-31", "2026-01-09", "2026-12-31"],
        short: ["2024-02-22", "2024-03-07", "2024-05-08", "2024-06-11", "2024-11-02", "2025-03-07", "2025-04-30", "2025-06-11", "2025-11-01", "2026-04-30", "2026-05-08", "2026-06-11", "2026-11-03"]
    },

    getIsoDate(dateObj) {
        if (!dateObj) return "";
        const d = new Date(dateObj);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    },

    // Вспомогательная: Является ли день выходным (Сб, Вс или Праздник)
    isWeekendOrHoliday(dateObj) {
        if (!dateObj) return false;
        const d = new Date(dateObj);
        const iso = this.getIsoDate(d);
        const md = iso.slice(5);
        const day = d.getDay();

        if (this.holidaysData.workOnWeekend.includes(iso)) return false;
        if (this.holidaysData.restOnWorkday.includes(iso)) return true;
        if (this.holidaysData.fixed.includes(md)) return true;
        if (day === 0 || day === 6) return true;
        return false;
    },

    // Проверка только на Гос. Праздник (для оплаты x2)
    isStateHoliday(dateObj) {
        if (!dateObj) return false;
        const d = new Date(dateObj);
        const md = this.getIsoDate(d).slice(5);
        return this.holidaysData.fixed.includes(md);
    },

    getMonthNorm(year, month) {
        if (!year || month == null) return 160;
        let workDays = 0;
        let shortDays = 0;
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        for (let d = 1; d <= daysInMonth; d++) {
            const current = new Date(year, month, d);
            const iso = this.getIsoDate(current);
            if (!this.isWeekendOrHoliday(current)) {
                workDays++;
                if (this.holidaysData.short.includes(iso)) shortDays++;
            }
        }
        const norm = (workDays * 7.2) - shortDays;
        return norm > 0 ? parseFloat(norm.toFixed(1)) : 0;
    },

    // Основной парсер
    parseShift(text, dateStr) {
        if (!text) return null;
        const lowerText = text.toLowerCase().trim();
        let type = SHIFT_TYPES.WORK;

        if (lowerText.includes('бл') || lowerText.includes('больничный')) type = SHIFT_TYPES.SICK;
        else if (lowerText.includes('отпуск') || lowerText.includes('отп')) type = SHIFT_TYPES.VACATION;
        else if (lowerText.includes('донор') || lowerText.includes('кровь')) type = SHIFT_TYPES.DONOR;
        else if (lowerText.includes('упц') || lowerText.includes('учеба') || lowerText.includes('обучение')) type = SHIFT_TYPES.TRAINING;
        else if (lowerText.includes('мед.ком') || lowerText.includes('комиссия') || lowerText.includes('медком')) type = SHIFT_TYPES.MED_CHECK;
        else if (lowerText.includes('рез')) type = SHIFT_TYPES.RESERVE;
        else if (lowerText.includes('вых')) type = SHIFT_TYPES.OTHER;

        const timeData = this.extractTime(text);
        
        let startTime = null;
        let endTime = null;

        if (timeData) {
             startTime = timeData.startStr; // "HH:MM"
             endTime = timeData.endStr;     // "HH:MM"
        }

        const isTech = lowerText.includes('тех') && lowerText.includes('учеба');

        return {
            date: dateStr,
            originalText: text,
            type: type,
            
            // ВАЖНО: Передаем строки, которые ждет calculator.js
            startTime: startTime,
            endTime: endTime,
            
            // Старые поля (на всякий случай)
            rawDuration: timeData ? timeData.minutes : 0,
            
            isTech: isTech,
            isReserve: type === SHIFT_TYPES.RESERVE
        };
    },

    extractTime(text) {
        // Ищем время в формате ЧЧ:ММ или Ч:ММ
        const matches = [...text.matchAll(/(\d{1,2})[:\.](\d{2})/g)];
        if (matches.length < 2) return null;

        // Форматируем в 00:00 для стандарта
        const fmt = (h, m) => `${h.padStart(2, '0')}:${m}`;

        const h1 = matches[0][1]; const m1 = matches[0][2];
        const h2 = matches[1][1]; const m2 = matches[1][2];

        const startStr = fmt(h1, m1);
        const endStr = fmt(h2, m2);

        // Расчет минут для внутренней логики
        const startMin = parseInt(h1) * 60 + parseInt(m1);
        let endMin = parseInt(h2) * 60 + parseInt(m2);
        if (endMin < startMin) endMin += 24 * 60;

        return { 
            startStr, 
            endStr, 
            minutes: (endMin - startMin) 
        };
    },

    // Обработка связок (разрывов)
    processShiftSequence(shifts) {
        // Для MVP 5.0 калькулятора эта функция пока может быть простой заглушкой,
        // так как калькулятор сам считает разрывы в renderStats.
        // Но оставим сортировку для порядка.
        shifts.sort((a, b) => new Date(a.date) - new Date(b.date));
        return shifts;
    }
};