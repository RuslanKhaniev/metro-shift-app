/**
 * calculator.js
 * Версия 4.0: "Фактический" расчет. 
 * Резерв = дешевле + нет наставника. 
 * Часть на линии = дороже + есть наставник.
 */

const Calculator = {
    
    calculateShift(shift, settings) {
        // Пропускаем нерабочие смены
        if (shift.type !== 'WORK' && shift.type !== 'RESERVE' && shift.type !== 'TRAINING' && shift.type !== 'MED_CHECK') {
            return this.calculateNonWork(shift, settings);
        }

        const profileRate = parseFloat(settings.rate) || 0;
        const bareRate = profileRate / 1.12; 

        // 1. РАСЧЕТ ВРЕМЕНИ (Резерв vs Линия)
        let totalMinutes = shift.paidDuration;
        let lineMinutes = 0;

        // Если это РЕЗЕРВ и указано время выезда -> считаем сколько минут были на линии
        if (shift.type === 'RESERVE' && shift.lineStart && shift.lineEnd) {
             lineMinutes = this.calculateTimeDiff(shift.lineStart, shift.lineEnd);
             // Защита: Выезд не может быть больше всей смены
             if (lineMinutes > totalMinutes) lineMinutes = totalMinutes;
        }
        // Если это ОБЫЧНАЯ РАБОТА (или Учеба) -> всё время считается "Линией" (полная ставка)
        else if (shift.type !== 'RESERVE' && !shift.isFullMedical) {
             lineMinutes = totalMinutes;
        }
        // Если ОТСТРАНЕНИЕ -> Линия = 0

        let reserveMinutes = Math.max(0, totalMinutes - lineMinutes);


        // 2. СТАВКИ
        // Линия = Полная ставка (12% вредность)
        let rateLine = profileRate;
        // Резерв = Голая + 8% вредности
        let rateReserve = bareRate * 1.08; 
        
        // Переопределение при отстранении
        if (shift.isFullMedical) {
            lineMinutes = 0;
            reserveMinutes = totalMinutes;
            rateReserve = bareRate; // Голая ставка
        }

        // 3. СЧИТАЕМ ТАРИФ (СУММА ДВУХ ЧАСТЕЙ)
        const moneyLinePart = (lineMinutes / 60) * rateLine;
        const moneyResPart = (reserveMinutes / 60) * rateReserve;
        
        const tariffMoney = moneyLinePart + moneyResPart;


        // 4. НАСТАВНИК (Только за время на линии!)
        let moneyMentor = 0;
        if (settings.mentor && !shift.isFullMedical) {
             // 15% от денег, заработанных НА ЛИНИИ
             moneyMentor = moneyLinePart * 0.15;
        }

        // 5. ОСТАЛЬНЫЕ БОНУСЫ (Класс, Выслуга, Старший)
        // Считаются от ПОЛНОЙ ставки за ВСЕ время (как ты просил ранее)
        const hours = shift.paidDuration / 60;
        const fullBaseMoney = hours * profileRate; 

        const holidayHours = this.getHolidayHours(shift);
        // Праздничные: для простоты считаем по "доминирующей" ставке (или резерв, или линия), 
        // но честнее взять среднюю. В рамках погрешности возьмем: 
        // Тариф праздничного часа = (tariffMoney / hours).
        // Но чтобы не усложнять:
        // Если смена РЕЗЕРВ -> платим по ставке Резерва. Если РАБОТА -> по ставке Линии.
        // Выезд в праздник внутри резерва — это редкость, оставим rateReserve как базу для x2.
        let holidayRate = (shift.type === 'RESERVE' && !shift.isFullMedical) ? rateReserve : rateLine;
        if (shift.isFullMedical) holidayRate = bareRate;
        
        const holidayBonusMoney = holidayHours * holidayRate;

        // Ночные / Вечерние
        const nightMoney = (shift.paidNight / 60) * bareRate * 0.40;
        // Вечерние обычно зависят от ставки часа. Пусть будет от основной ставки смены.
        const eveningMoney = (shift.paidEvening / 60) * ((shift.type === 'RESERVE') ? rateReserve : rateLine) * 0.20;

        // Разрывная
        let splitMoney = 0;
        if (shift.isSplit && !shift.isFullMedical) {
            splitMoney = tariffMoney * 0.30;
        }

        // Тех. учеба
        let moneyTech = 0;
        if (shift.isTech) {
             moneyTech = (profileRate / 1.245) * 2;
        }

        // === НАДБАВКИ ОТ ПОЛНОЙ БАЗЫ ===
        const percentClass = parseFloat(settings.classP) || 0;
        const percentSen = this.getSeniorityPercent(settings.startDate);
        const percentBonus = parseFloat(settings.premP) || 0;

        const moneyClass = fullBaseMoney * (percentClass / 100);
        const moneySen = fullBaseMoney * (percentSen / 100);
        
        let moneySenior = 0;
        if (settings.senior) {
            moneySenior = fullBaseMoney * 0.10;
        }

        // ПРЕМИЯ (База как договорились)
        const baseForBonus = tariffMoney + 
                             moneyClass + 
                             moneySen + 
                             moneyMentor + 
                             moneySenior + 
                             moneyTech + 
                             splitMoney;

        const moneyPremium = baseForBonus * (percentBonus / 100);

        // ИТОГО
        const dirty = tariffMoney + 
                      holidayBonusMoney + 
                      nightMoney + 
                      eveningMoney + 
                      splitMoney + 
                      moneyTech + 
                      moneyClass + 
                      moneySen + 
                      moneyMentor + 
                      moneySenior + 
                      moneyPremium;

        return {
            date: shift.date,
            dirty: dirty,
            net: Math.round(dirty * 0.87), 
            hours: hours,
            duration: hours,
            // Для отладки можно вывести lineWorkHours
            lineWorkHours: lineMinutes / 60,
            
            night: shift.paidNight / 60,
            ev: shift.paidEvening / 60,
            
            details: {
                tariff: tariffMoney,
                holiday: holidayBonusMoney,
                night: nightMoney,
                evening: eveningMoney,
                split: splitMoney,
                tech: moneyTech,
                class: moneyClass,
                sen: moneySen,
                mentor: moneyMentor,
                senior: moneySenior,
                premium: moneyPremium
            },
            isSplit: shift.isSplit, isFullNight: shift.isFullNight, isTech: shift.isTech, 
            isRes: shift.type === 'RESERVE', isTrain: shift.type === 'TRAINING' || shift.type === 'MED_CHECK',
            isFullMed: shift.isFullMedical
        };
    },

    // Вспомогательная функция для расчета разницы времени (чч:мм)
    calculateTimeDiff(startStr, endStr) {
        if (!startStr || !endStr) return 0;
        const [h1, m1] = startStr.split(':').map(Number);
        const [h2, m2] = endStr.split(':').map(Number);
        
        const minutes1 = h1 * 60 + m1;
        const minutes2 = h2 * 60 + m2;
        
        let diff = minutes2 - minutes1;
        // Если переход через полночь (23:00 - 01:00)
        if (diff < 0) diff += 24 * 60;
        
        return diff;
    },

    getHolidayHours(shift) {
        if (!shift.startTimestamp) return 0;
        if (Logic.isStateHoliday(shift.startTimestamp)) return shift.paidDuration / 60; 
        if (shift.startTimestamp.getMonth() === 11 && shift.startTimestamp.getDate() === 31) return this.calculateTailHours(shift);
        return 0;
    },

    calculateTailHours(shift) {
        if (!shift.endTimestamp) return 0;
        const start = shift.startTimestamp;
        const end = shift.endTimestamp;
        if (start.getDate() === end.getDate()) return 0;
        const midnight = new Date(start);
        midnight.setHours(24, 0, 0, 0);
        const tailMs = end - midnight;
        return tailMs > 0 ? tailMs / (1000 * 60 * 60) : 0;
    },
    
    calculateOvertimePay(overtimeHours, settings) {
        if (overtimeHours <= 0) return { money15: 0, money20: 0, total: 0 };
        const rate = parseFloat(settings.rate) || 0;
        let hours15 = (overtimeHours <= 2) ? overtimeHours : 2;
        let hours20 = (overtimeHours <= 2) ? 0 : overtimeHours - 2;
        
        const money15 = hours15 * rate * 0.5; 
        const money20 = hours20 * rate * 1.0; 
        
        return { hours15, money15, hours20, money20, total: money15 + money20 };
    },

    getSeniorityPercent(startDateStr) {
        if (!startDateStr) return 0;
        const start = new Date(startDateStr);
        const now = new Date();
        if (start > now) return 0; 
        const years = (now - start) / (1000 * 60 * 60 * 24 * 365.25);
        if (years >= 20) return 30;
        if (years >= 15) return 25;
        if (years >= 10) return 20;
        if (years >= 5) return 15;
        if (years >= 3) return 10;
        return 5; 
    },

    calculateNonWork(shift, settings) {
        return {
            date: shift.date,
            dirty: 0,
            net: 0,
            hours: 0,
            duration: 0,
            isNonWork: true,
            
            night: 0, 
            ev: 0
        };
    }
};
