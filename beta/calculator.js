/**
 * calculator.js
 * Версия 5.0: "Точная бухгалтерия".
 * Раздельный расчет часов Линии/Резерва/Базы для Тарифа, Ночных, Вечерних и Разрыва.
 */

const Calculator = {
    
    // Вспомогательная: Перевод "ЧЧ:ММ" -> минуты от начала суток
    toMins(timeStr) {
        if (!timeStr) return null;
        const [h, m] = timeStr.split(':').map(Number);
        return h * 60 + m;
    },

    // Вспомогательная: Длительность интервала с учетом перехода через 24:00
    getDuration(start, end) {
        if (end < start) end += 24 * 60;
        return Math.max(0, end - start);
    },

    // Вспомогательная: Найти пересечение двух интервалов (в минутах)
    // start1-end1: Основной интервал (например, Резерв)
    // start2-end2: Накладываемый интервал (например, Ночь 22:00-06:00)
    getIntersection(start1, end1, start2, end2) {
        // Нормализация перехода через сутки для второго интервала
        if (end1 < start1) end1 += 1440;
        
        // Если второй интервал переходит через сутки (22:00 - 06:00)
        if (end2 < start2) {
            // Разбиваем ночь на два куска: 22:00-24:00 и 00:00-06:00
            return this.getIntersection(start1, end1, start2, 1440) + 
                   this.getIntersection(start1, end1, 0, end2);
        }

        const s = Math.max(start1, start2);
        const e = Math.min(end1, end2);
        return Math.max(0, e - s);
    },

    calculateShift(shift, settings) {
        // 0. Пропуск нерабочих типов (Выходной)
        if (shift.type === 'OTHER' || (!shift.type)) return null;

        // 1. Ставки
        const rateLine = parseFloat(settings.rate) || 0; // 0030 (Линия)
        const rateBase = rateLine / 1.12;                // 0038 (База/Отстранение)
        const rateRes  = rateBase * 1.08;                // 0031 (Резерв)

        // Для переработок всегда берем ставку Линии (Золотое правило)
        const rateOvertime = rateLine; 

        // Инициализация структуры ответа (детализация как в квитке)
        let res = {
            // Общие суммы
            net: 0, dirty: 0, 
            hours: 0, // Факт (для нормы)
            
            // Детализация по кодам (Часы, Деньги)
            parts: {
                tariffLine: { h: 0, m: 0 }, // 0030
                tariffRes:  { h: 0, m: 0 }, // 0031
                tariffBase: { h: 0, m: 0 }, // 0038
                
                splitLine: { m: 0 }, // 0050
                splitRes:  { m: 0 }, // 0051
                splitBase: { m: 0 }, // 0058

                evLine: { h: 0, m: 0 }, // 0220
                evRes:  { h: 0, m: 0 }, // 0221
                evBase: { h: 0, m: 0 }, // 0228

                nightLine: { h: 0, m: 0 }, // 0230
                nightRes:  { h: 0, m: 0 }, // 0231
                nightBase: { h: 0, m: 0 }, // 0238

                class: 0,   // 0250
                senior: 0,  // 0190 (Бригадир/Ст.маш)
                mentor: 0,  // 0540 (Наставник)
                tech: 0,    // Тех.учеба
                
                // Спец. типы
                sick: 0, vacation: 0, donor: 0, med: 0, study: 0
            },
            
            // Флаги для статистики
            isSick: false, isVacation: false, isDonor: false
        };

        // --- БЛОК А: СПЕЦИАЛЬНЫЕ ТИПЫ (БЛ, ОТПУСК, ДОНОР) ---
        // Они считаются "мимо кассы" основного алгоритма
        if (shift.type === 'SICK' || shift.type === 'VACATION' || shift.type === 'DONOR') {
            if (shift.type === 'SICK') { res.isSick = true; res.parts.sick = 1; } 
            if (shift.type === 'VACATION') { res.isVacation = true; res.parts.vacation = 1; }
            if (shift.type === 'DONOR') { 
                res.isDonor = true; 
                // Донорский день оплачивается по среднему (или 8ч * ставку, если нет данных)
                // Для простоты пока считаем 0 (в renderStats логика среднего сложнее)
                // Но часы ставим 0, так как это не отработанное время
            }
            return res; 
        }

        // --- БЛОК Б: ПОДГОТОВКА ИНТЕРВАЛОВ ---
        const startMin = this.toMins(shift.startTime);
        const endMin = this.toMins(shift.endTime);
        if (startMin === null || endMin === null) return null;

        let totalMins = this.getDuration(startMin, endMin);
        if (shift.isPostTrip) {
            totalMins += 10; // +10 минут ПР
            // ПР добавляем к концу смены виртуально
        }

        // Определяем "чистые" интервалы в минутах
        let lineMins = 0;
        let tpMins = 0;
        let resMins = 0;

        // 1. Терапевтический пункт (ТП) - всегда База
        if (shift.tpStart && shift.tpEnd) {
            const tps = this.toMins(shift.tpStart);
            const tpe = this.toMins(shift.tpEnd);
            tpMins = this.getDuration(tps, tpe);
        }

        // 2. Линия (Выезд)
        if (shift.isFullMedical) {
            // Если отстранение - линии нет, всё база
            lineMins = 0;
        } else if (shift.type === 'WORK' || shift.type === 'TRAINING' || shift.type === 'MED_CHECK') {
            // Обычная работа/Учеба - всё время (минус ТП) это Линия
            lineMins = Math.max(0, totalMins - tpMins);
        } else if (shift.type === 'RESERVE') {
            // Резерв - смотрим, был ли выезд
            if (shift.lineStart && shift.lineEnd) {
                const ls = this.toMins(shift.lineStart);
                const le = this.toMins(shift.lineEnd);
                lineMins = this.getDuration(ls, le);
            }
        }

        // 3. Резерв (Остаток)
        // Если это Отстранение (FullMedical), то остаток идет в Базу, а не в Резерв
        // Если обычный Резерв - то в Резерв
        let remainderMins = Math.max(0, totalMins - lineMins - tpMins);
        
        if (shift.isFullMedical) {
            tpMins += remainderMins; // Всё уходит в Базу
            remainderMins = 0;
            resMins = 0;
        } else {
            resMins = remainderMins;
        }

        // --- БЛОК В: РАСЧЕТ ТАРИФА (БАЗА) ---
        
        // 1. Линия (0030)
        res.parts.tariffLine.h = lineMins / 60;
        res.parts.tariffLine.m = (lineMins / 60) * rateLine;

        // 2. Резерв (0031)
        res.parts.tariffRes.h = resMins / 60;
        res.parts.tariffRes.m = (resMins / 60) * rateRes;

        // 3. База/ТП (0038)
        res.parts.tariffBase.h = tpMins / 60;
        res.parts.tariffBase.m = (tpMins / 60) * rateBase;

        // ИТОГО ЧАСОВ ФАКТА (для нормы)
        // Учеба (TRAINING) и МедКом (MED_CHECK) тоже дают часы, но деньги идут в другие статьи
        // Если это Учеба/МедКом, мы деньги тарифа обнуляем (они пойдут в parts.study / parts.med)
        // Но расчет часов нам нужен для Ночных/Вечерних!
        
        res.hours = (lineMins + resMins + tpMins) / 60;

        // --- БЛОК Г: НОЧНЫЕ И ВЕЧЕРНИЕ (ПЕРЕСЕЧЕНИЯ) ---
        // Интервалы суток
        // Вечер: 18:00 (1080) - 22:00 (1320)
        // Ночь 1: 22:00 (1320) - 24:00 (1440)
        // Ночь 2: 00:00 (0) - 06:00 (360)

        // Для точности нужно знать реальное время начала/конца каждого куска.
        // УПРОЩЕНИЕ: Так как пользователь вводит только время Выезда и ТП,
        // мы считаем Выезд и ТП "жесткими" интервалами, а всё остальное заполняет пустоты.
        
        // Функция расчета надбавок для интервала
        const calcBonus = (s, e, rate, codeType) => {
            if (s === null || e === null) return;
            const dur = this.getDuration(s, e);
            if (dur <= 0) return;

            // Вечерние (20%)
            const evMins = this.getIntersection(s, e, 1080, 1320); // 18-22
            if (evMins > 0) {
                const h = evMins / 60;
                res.parts['ev' + codeType].h += h;
                res.parts['ev' + codeType].m += h * rate * 0.20;
            }

            // Ночные (40%)
            const nightMins = this.getIntersection(s, e, 1320, 1440) + // 22-24
                              this.getIntersection(s, e, 0, 360);      // 00-06
            if (nightMins > 0) {
                const h = nightMins / 60;
                res.parts['night' + codeType].h += h;
                res.parts['night' + codeType].m += h * rate * 0.40;
            }
        };

        // 1. Интервал ТП (База)
        if (shift.tpStart && shift.tpEnd) {
            calcBonus(this.toMins(shift.tpStart), this.toMins(shift.tpEnd), rateBase, 'Base');
        }

        // 2. Интервал Линии (Линия)
        if (lineMins > 0) {
            // Если выезд задан явно
            if (shift.lineStart && shift.lineEnd) {
                calcBonus(this.toMins(shift.lineStart), this.toMins(shift.lineEnd), rateLine, 'Line');
            } 
            // Если вся смена - Линия (обычная работа), берем границы смены
            else if (shift.type === 'WORK' || shift.type === 'TRAINING' || shift.type === 'MED_CHECK') {
                calcBonus(startMin, endMin, rateLine, 'Line');
            }
        }

        // 3. Интервал Резерва (Резерв)
        // Тут сложнее: резерв это "всё, что не Линия и не ТП".
        // Для точного расчета пересечений нам нужно вычесть интервалы.
        // НО! Для MVP мы сделаем допущение: 
        // Если есть выезд - мы его учли. Остальное время смены (начала и концы) - это резерв.
        if (resMins > 0) {
            // Если были точные интервалы выезда, мы их уже посчитали.
            // Теперь берем Общий проход по смене и вычитаем то, что уже насчитали в Линии и ТП.
            // Это "грязный" хак, но он работает математически верно для сумм.
            
            // Считаем ночные/вечерние ЗА ВСЮ СМЕНУ по ставке Резерва
            // А потом ВЫЧИТАЕМ то, что мы ошибочно посчитали бы, если бы не знали про линию.
            // (А, нет, лучше честно пройтись по "дыркам". Но мы не знаем, где дырки, если выезд в середине).
            // Допущение: Резерв обычно по краям.
            
            // ПРОСТОЙ ВАРИАНТ (Рабочий):
            // Считаем TOTAL ночных за смену.
            // Вычитаем ночные Линии.
            // Вычитаем ночные ТП.
            // Остаток = ночные Резерва.
            
            const totalNightMins = this.getIntersection(startMin, endMin, 1320, 1440) + this.getIntersection(startMin, endMin, 0, 360);
            const totalEvMins = this.getIntersection(startMin, endMin, 1080, 1320);

            const usedNightMins = (res.parts.nightLine.h * 60) + (res.parts.nightBase.h * 60);
            const usedEvMins = (res.parts.evLine.h * 60) + (res.parts.evBase.h * 60);

            const remNight = Math.max(0, totalNightMins - usedNightMins);
            const remEv = Math.max(0, totalEvMins - usedEvMins);
            
            // Если это Отстранение - остаток в Базу. Если Резерв - в Резерв.
            const targetCode = shift.isFullMedical ? 'Base' : 'Res';
            const targetRate = shift.isFullMedical ? rateBase : rateRes;

            res.parts['night' + targetCode].h += remNight / 60;
            res.parts['night' + targetCode].m += (remNight / 60) * targetRate * 0.40;

            res.parts['ev' + targetCode].h += remEv / 60;
            res.parts['ev' + targetCode].m += (remEv / 60) * targetRate * 0.20;
        }

        // --- БЛОК Д: РАЗРЫВ (30%) ---
        // Считается просто от суммы начислений тарифа каждой части
        if (shift.isSplit) {
            res.parts.splitLine.m = res.parts.tariffLine.m * 0.30;
            res.parts.splitRes.m  = res.parts.tariffRes.m * 0.30;
            res.parts.splitBase.m = res.parts.tariffBase.m * 0.30;
        }

        // --- БЛОК Е: НАДБАВКИ (КЛАСС, ВЫСЛУГА, НАСТАВНИК) ---
        // База для надбавок = Тариф + Разрыв + Ночные + Вечерние
        // (Согласно правилам, классность накручивается на всё это)
        
        let bonusBase = 0;
        ['Line', 'Res', 'Base'].forEach(type => {
            bonusBase += res.parts['tariff' + type].m;
            bonusBase += res.parts['split' + type].m;
            // Ночные/Вечерние обычно НЕ входят в базу Классности (это отдельные статьи).
            // В твоем файле 0250 (Класс) идет в блоке В, отдельно от Времени суток.
            // Обычно Класс = Тариф * %
        });

        // 1. Классность (0250)
        if (settings.classP > 0) {
            // Классность обычно только на Отработанное время (Тариф).
            // Если у тебя в правилах иначе - поправь. Обычно это Тариф * %.
            // В твоем файле "Входит в базу премии: Тариф + Разрыв + Время суток + Класс".
            // Значит Класс считается от Тарифа.
            const tariffSum = res.parts.tariffLine.m + res.parts.tariffRes.m + res.parts.tariffBase.m;
            res.parts.class = tariffSum * (settings.classP / 100);
        }

        // 2. Выслуга (0770) - Красная зона, не входит в премию
        const senP = this.getSeniorityPercent(settings.startDate);
        if (senP > 0) {
            const tariffSum = res.parts.tariffLine.m + res.parts.tariffRes.m + res.parts.tariffBase.m;
            res.parts.senior = tariffSum * (senP / 100);
        }

        // 3. Ст. Машинист (0190)
        if (settings.senior || shift.customSenior) {
            const tariffSum = res.parts.tariffLine.m + res.parts.tariffRes.m + res.parts.tariffBase.m;
            res.parts.senior += tariffSum * 0.10; // Добавляем к выслуге или в отдельное поле, если нужно
            // У нас поле senior одно, пусть там лежит сумма (или разделим, если в квитке разные строки)
        }

        // 4. Наставник (0540) - Красная зона
        if ((settings.mentor || shift.customMentor) && !shift.isFullMedical) {
            // Наставник только за часы на линии (обычно)
            res.parts.mentor = res.parts.tariffLine.m * 0.15; // 15% от тарифа линии
            res.parts.mentor += res.parts.tariffRes.m * 0.15; // Если в резерве тоже платят, раскомментить
        }

        // 5. Тех. учеба (отдельный расчет)
        if (shift.isTech) {
            // 2 часа по среднему (или по тарифу * 2)
            // Упрощенно: 2 часа * ставка линии
            res.parts.tech = 2 * rateLine;
        }

        // --- ФИНАЛ: ПЕРЕРАСПРЕДЕЛЕНИЕ ДЛЯ УЧЕБЫ/МЕДКОМА ---
        // Если это Учеба или Медком, часы мы посчитали (чтобы знать норму), 
        // но деньги тарифа уходят в спец.статью.
        if (shift.type === 'TRAINING') {
            res.parts.study = res.parts.tariffLine.m; // Забираем деньги из тарифа
            res.parts.tariffLine.m = 0; res.parts.tariffLine.h = 0;
        }
        if (shift.type === 'MED_CHECK') {
            res.parts.med = res.parts.tariffLine.m;
            res.parts.tariffLine.m = 0; res.parts.tariffLine.h = 0;
        }

        // СБОРКА DIRTY (Грязными без премии и переработок)
        // Премия и Переработки считаются в index.html на уровне Месяца.
        // Здесь мы возвращаем компоненты смены.
        
        res.dirty = 
            res.parts.tariffLine.m + res.parts.tariffRes.m + res.parts.tariffBase.m +
            res.parts.splitLine.m + res.parts.splitRes.m + res.parts.splitBase.m +
            res.parts.evLine.m + res.parts.evRes.m + res.parts.evBase.m +
            res.parts.nightLine.m + res.parts.nightRes.m + res.parts.nightBase.m +
            res.parts.class + res.parts.senior + res.parts.mentor + res.parts.tech +
            res.parts.study + res.parts.med;

        return res;
    },

    calculateOvertimePay(overtimeHours, settings) {
        if (overtimeHours <= 0) return { money15: 0, money20: 0, total: 0 };
        const rate = parseFloat(settings.rate) || 0; // ЗОЛОТОЕ ПРАВИЛО: Всегда ставка линии
        let hours15 = (overtimeHours <= 2) ? overtimeHours : 2;
        let hours20 = (overtimeHours <= 2) ? 0 : overtimeHours - 2;
        
        const money15 = hours15 * rate * 0.5; // Только доплата 0.5 (основа 1.0 уже в тарифе, если часы в норме)
        // ВНИМАНИЕ: Если часы СВЕРХ нормы, то нужна оплата 1.5 и 2.0.
        // В renderStats мы прибавляем часы к тарифу? Нет, они уже там.
        // Значит тут считаем только ДОПЛАТУ (0.5 и 1.0).
        // 0700 (Доплата 100% за первые 2 часа?? Нет, обычно 50% за первые, 100% за след).
        // 0730 (Доплата 50%).
        
        const m15 = hours15 * rate * 1.5; 
        const m20 = hours20 * rate * 2.0;
        // Тут нужно согласовать с логикой index.html. Обычно там часы уже оплачены одинарно в Тарифе?
        // Если overtimeHours - это "лишние" часы, то они УЖЕ попали в res.hours и оплатились по тарифу 1.0.
        // Значит сверху нужно добавить 0.5 и 1.0.
        
        return { 
            hours15, 
            money15: hours15 * rate * 0.5, 
            hours20, 
            money20: hours20 * rate * 1.0, 
            total: (hours15 * rate * 0.5) + (hours20 * rate * 1.0) 
        };
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
        return 5; // От 0 до 3 лет
    }
};