/**
 * calc_logic.js
 * Логика парсинга времени и обработки последовательности смен.
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
        workOnWeekend: [
            "2024-04-27", "2024-11-02", "2024-12-28", 
            "2025-11-01" 
        ],
        restOnWorkday: [
            "2024-04-29", "2024-04-30", "2024-05-10", "2024-12-30", "2024-12-31",
            "2025-05-02", "2025-05-08", "2025-06-13", "2025-11-03", "2025-12-31",
            "2026-01-09", "2026-12-31"
        ],
        short: [
            "2024-02-22", "2024-03-07", "2024-05-08", "2024-06-11", "2024-11-02", 
            "2025-03-07", "2025-04-30", "2025-06-11", "2025-11-01",
            "2026-04-30", "2026-05-08", "2026-06-11", "2026-11-03"
        ]
    },

    getIsoDate(dateObj) {
        if (!dateObj) return "";
        const d = new Date(dateObj);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    },

    /**
     * Проверка: Является ли день выходным или праздничным?
     * (Для окраски календаря в красный цвет)
     */

    isWeekendOrHoliday(dateObj) {
        if (!dateObj) return false;
        const d = new Date(dateObj);
        const iso = this.getIsoDate(d);
        const md = iso.slice(5);
        const day = d.getDay();

        // 1. Если это рабочая суббота -> НЕ выходной
        if (this.holidaysData.workOnWeekend.includes(iso)) return false;

        // 2. Если это перенесенный выходной -> ВЫХОДНОЙ
        if (this.holidaysData.restOnWorkday.includes(iso)) return true;

        // 3. Если гос. праздник (фиксированный) -> ВЫХОДНОЙ
        if (this.holidaysData.fixed.includes(md)) return true;

        // 4. Обычные СБ и ВС
        if (day === 0 || day === 6) return true;

        return false;
    },

    /**
     * Проверка: Положено ли x2 (Государственный праздник)?
     * Игнорирует обычные выходные.
     */
    isStateHoliday(dateObj) {
        if (!dateObj) return false;
        const d = new Date(dateObj);
        const md = this.getIsoDate(d).slice(5);
        // Только ст. 112 ТК РФ
        return this.holidaysData.fixed.includes(md);
    },

    /**
     * Расчет нормы часов за месяц (С учетом твоих переносов!)
     */
    getMonthNorm(year, month) {
        if (!year || month == null) return 160;
        let workDays = 0;
        let shortDays = 0;
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        for (let d = 1; d <= daysInMonth; d++) {
            const current = new Date(year, month, d);
            const iso = this.getIsoDate(current);

            // Если НЕ выходной (учитывая рабочие субботы)
            if (!this.isWeekendOrHoliday(current)) {
                workDays++;
                // Проверка на короткий день (из твоей базы)
                if (this.holidaysData.short.includes(iso)) {
                    shortDays++;
                }
            }
        }
        // Формула: (Раб.дни * 7.2) - (1ч за короткий день)
        // Или если у вас пятидневка: workDays * 8 - shortDays.
        // Оставляю как было в твоем index.html (7.2):
        const norm = (workDays * 7.2) - shortDays;
        return norm > 0 ? parseFloat(norm.toFixed(1)) : 0;
    },

    
    // 1. Парсинг одной строки (без контекста соседей)
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
        
        let startTimestamp = null;
        let endTimestamp = null;
        if (timeData) {
             const [y, m, d] = dateStr.split('-').map(Number);
             const sDate = new Date(y, m - 1, d);
             startTimestamp = new Date(sDate.getTime() + timeData.start * 60000);
             endTimestamp = new Date(sDate.getTime() + timeData.end * 60000);
        }

        const isTech = lowerText.includes('тех') && lowerText.includes('учеба');

        return {
            date: dateStr,
            originalText: text,
            type: type,
            // Сырые данные (до обработки правил)
            rawDuration: timeData ? timeData.minutes : 0,
            rawNight: timeData ? timeData.nightMinutes : 0,
            rawEvening: timeData ? timeData.eveningMinutes : 0,
            
            // Данные для оплаты (будут меняться в processShiftSequence)
            paidDuration: timeData ? timeData.minutes : 0, 
            paidNight: timeData ? timeData.nightMinutes : 0,
            paidEvening: timeData ? timeData.eveningMinutes : 0,
            
            startTimestamp: startTimestamp,
            endTimestamp: endTimestamp,
            
            isFullNight: false,
            isSplit: false,
            isTech: isTech,
            isReserve: type === SHIFT_TYPES.RESERVE
        };
    },

    extractTime(text) {
        const times = [...text.matchAll(/(\d{1,2}[:\.]\d{2})/g)];
        if (times.length < 2) return null;

        const parse = (t) => {
            const parts = t.replace('.', ':').split(':');
            return parseInt(parts[0]) * 60 + parseInt(parts[1]);
        };

        let start = parse(times[0][0]);
        let end = parse(times[1][0]);
        if (end < start) end += 24 * 60;

        let night = 0;
        let evening = 0;

        for (let m = start; m < end; m++) {
            let t = m % 1440;
            if (t >= 1320 || t < 360) night++;
            else if (t >= 960 && t < 1320) evening++;
        }

        return { start, end, minutes: (end - start), nightMinutes: night, eveningMinutes: evening };
    },

    // 2. Обработка списка смен (связки, разрывы, правило 50%)
    processShiftSequence(shifts) {
        // Сортируем
        shifts.sort((a, b) => {
            if (!a.startTimestamp || !b.startTimestamp) return 0;
            return a.startTimestamp - b.startTimestamp;
        });

        for (let i = 0; i < shifts.length; i++) {
            let curr = shifts[i];
            if (curr.type !== SHIFT_TYPES.WORK && curr.type !== SHIFT_TYPES.RESERVE) continue;
            if (!curr.endTimestamp) continue;

            let next = shifts[i + 1];
            let isLinked = false;

            if (next && (next.type === SHIFT_TYPES.WORK || next.type === SHIFT_TYPES.RESERVE) && next.startTimestamp) {
                let gapMinutes = (next.startTimestamp - curr.endTimestamp) / 60000;

                // Разрыв меньше 8 часов (480 мин) считается связкой
                if (gapMinutes >= 0 && gapMinutes < 480) {
                    isLinked = true;

                    // === ПРАВИЛО 50% (СУММАРНОЕ) ===
                    const totalDur = curr.rawDuration + next.rawDuration;
                    const totalNight = curr.rawNight + next.rawNight;
                    
                    if (totalDur > 0 && (totalNight / totalDur) >= 0.5) {
                        this.applyFullNight(curr);
                        this.applyFullNight(next);
                    } else {
                        // Проверяем по отдельности, если сумма не дотянула
                        this.checkSingleFullNight(curr);
                        this.checkSingleFullNight(next);
                    }
                    
                    // Помечаем как разрывную (если разрыв > 2.5 часов / 150 мин)
                    if (gapMinutes >= 150) {
                        curr.isSplit = true;
                        next.isSplit = true;
                    }
                    
                    i++; // Пропускаем следующую, т.к. обработали парой
                    continue; 
                }
            }

            if (!isLinked) {
                this.checkSingleFullNight(curr);
            }
        }
        return shifts;
    },

    applyFullNight(shift) {
        shift.isFullNight = true;
        shift.paidNight = shift.rawDuration;
        shift.paidEvening = 0;
    },

    checkSingleFullNight(shift) {
        if (shift.rawDuration > 0 && (shift.rawNight / shift.rawDuration) >= 0.5) {
            this.applyFullNight(shift);
        }
    }
};