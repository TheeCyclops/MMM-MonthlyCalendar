function createElement(tag, options) {
  const node = document.createElement(tag);
  const settings = options || {};
  Object.keys(settings).forEach((key) => {
    node[key] = settings[key];
  });
  return node;
}

Module.register("MMM-MonthlyCalendar", {
  defaults: {
    mode: "currentMonth",
    firstDayOfWeek: "sunday",
    showWeekNumber: false,
    displaySymbol: false,
    wrapTitles: false,
    hideCalendars: [],
    luminanceThreshold: 110,
    multiDayEndingTimeSeparator: " until ",
    hideDuplicateEvents: true,
    swipeThreshold: 50,
    maxEventsPerDay: 2
  },

  start: function () {
    this.sourceEvents = {};
    this.events = [];
    this.displayedDay = null;
    this.displayedEvents = [];
    this.updateTimer = null;
    this.skippedUpdateCount = 0;
    this.touchStartX = null;
    this.touchStartY = null;
    this.selectedDate = this.startOfDay(new Date());
    this.visibleMonthStart = this.startOfMonth(this.selectedDate);
    this.selectedCalendars = Array.isArray(this.config.selectedCalendars)
      ? this.config.selectedCalendars.slice()
      : null;
  },

  getStyles: function () {
    return ["MMM-MonthlyCalendar.css"];
  },

  startOfDay: function (date) {
    const value = new Date(date);
    value.setHours(0, 0, 0, 0);
    return value;
  },

  endOfDay: function (date) {
    const value = this.startOfDay(date);
    value.setDate(value.getDate() + 1);
    return value;
  },

  startOfMonth: function (date) {
    const value = this.startOfDay(date);
    value.setDate(1);
    return value;
  },

  addDays: function (date, amount) {
    const value = new Date(date);
    value.setDate(value.getDate() + amount);
    return value;
  },

  addMonths: function (date, amount) {
    return new Date(date.getFullYear(), date.getMonth() + amount, 1);
  },

  getConfiguredWeekStart: function () {
    const firstDay = String(this.config.firstDayOfWeek || "sunday").toLowerCase();
    if (firstDay === "monday") {
      return 1;
    }
    return 0;
  },

  getWeekStart: function (date) {
    const value = this.startOfDay(date);
    const weekStart = this.getConfiguredWeekStart();
    const dayIndex = value.getDay();
    const offset = (dayIndex - weekStart + 7) % 7;
    return this.addDays(value, -offset);
  },

  getVisibleMonthDays: function () {
    const firstVisible = this.getWeekStart(this.visibleMonthStart);
    const nextMonthStart = this.addMonths(this.visibleMonthStart, 1);
    const lastDayOfMonth = this.addDays(nextMonthStart, -1);
    const lastVisible = this.addDays(this.getWeekStart(lastDayOfMonth), 6);
    const days = [];

    for (let cursor = new Date(firstVisible); cursor <= lastVisible; cursor = this.addDays(cursor, 1)) {
      days.push(new Date(cursor));
    }

    return days;
  },

  getMonthLabel: function () {
    return this.visibleMonthStart.toLocaleDateString(config.language, {
      month: "long",
      year: "numeric"
    });
  },

  getMonthOptions: function () {
    return Array.from({ length: 12 }, (_, monthIndex) => ({
      value: monthIndex,
      label: new Date(2026, monthIndex, 1).toLocaleDateString(config.language, { month: "long" })
    }));
  },

  getYearOptions: function () {
    const currentYear = new Date().getFullYear();
    const visibleYear = this.visibleMonthStart.getFullYear();
    const startYear = Math.min(currentYear - 5, visibleYear - 5);
    const endYear = Math.max(currentYear + 5, visibleYear + 5);
    const years = [];

    for (let year = startYear; year <= endYear; year += 1) {
      years.push(year);
    }

    return years;
  },

  calendarIsVisible: function (calendarName) {
    if (this.config.hideCalendars.includes(calendarName)) {
      return false;
    }

    if (this.selectedCalendars === null) {
      return true;
    }

    return this.selectedCalendars.includes(calendarName);
  },

  rebuildEvents: function (forceDom = false) {
    const today = new Date().setHours(12, 0, 0, 0).valueOf();

    this.events = Object.values(this.sourceEvents)
      .flat()
      .filter((event) => this.calendarIsVisible(event.calendarName))
      .sort((a, b) => {
        if (!!a.fullDayEvent !== !!b.fullDayEvent) {
          return a.fullDayEvent ? -1 : 1;
        }
        if (a.startDate.valueOf() !== b.startDate.valueOf()) {
          return a.startDate - b.startDate;
        }
        if (a.endDate.valueOf() !== b.endDate.valueOf()) {
          return a.endDate - b.endDate;
        }
        return (a.title || "").localeCompare(b.title || "");
      });

    if (this.config.hideDuplicateEvents) {
      const seenEvents = new Map();
      this.events = this.events.filter((event) => {
        const key = `${event.title}|${event.startDate.valueOf()}|${event.endDate.valueOf()}`;
        if (seenEvents.has(key)) {
          return false;
        }
        seenEvents.set(key, true);
        return true;
      });
    }

    if (forceDom || today !== this.displayedDay || !this.eventsEqual(this.events, this.displayedEvents)) {
      this.displayedDay = today;
      this.displayedEvents = this.events.slice();
      this.updateTimer = null;
      this.skippedUpdateCount = 0;
      this.updateDom(120);
    }
  },

  eventsEqual: function (left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }

    return left.every((event, index) => {
      const other = right[index];
      return other
        && event.title === other.title
        && event.calendarName === other.calendarName
        && event.fullDayEvent === other.fullDayEvent
        && event.startDate.valueOf() === other.startDate.valueOf()
        && event.endDate.valueOf() === other.endDate.valueOf()
        && event.color === other.color;
    });
  },

  notificationReceived: function (notification, payload, sender) {
    if (notification === "CALENDAR_FILTER_SET" && Array.isArray(payload)) {
      this.selectedCalendars = payload.slice();
      this.rebuildEvents(true);
      return;
    }

    if ((notification === "CALENDAR_DAY_DETAILS_SET_DATE" || notification === "DAILY_SCHEDULE_SET_DATE") && payload) {
      const nextDate = new Date(payload);
      if (Number.isFinite(nextDate.valueOf())) {
        this.selectedDate = this.startOfDay(nextDate);
        this.visibleMonthStart = this.startOfMonth(nextDate);
        this.updateDom(120);
      }
      return;
    }

    if (notification === "CALENDAR_EVENTS") {
      if (!Array.isArray(payload)) {
        console.error("Payload is not an array:", payload);
        return;
      }

      this.sourceEvents[sender.identifier] = payload.map((event) => {
        const normalized = Object.assign({}, event);
        normalized.startDate = new Date(+normalized.startDate);
        normalized.endDate = new Date(+normalized.endDate);

        if (normalized.fullDayEvent) {
          normalized.endDate = new Date(normalized.endDate.getTime() - 1000);

          if (normalized.startDate > normalized.endDate) {
            normalized.startDate = new Date(normalized.endDate.getFullYear(), normalized.endDate.getMonth(), normalized.endDate.getDate(), 1);
          } else {
            normalized.startDate = new Date(normalized.startDate.getTime() + 60 * 60 * 1000);
          }
        }

        if (((normalized.endDate.getTime() - normalized.startDate.getTime()) / 1000) > 86400) {
          normalized.multiDayEvent = true;
        }

        return normalized;
      });

      if (this.updateTimer !== null) {
        clearTimeout(this.updateTimer);
        this.skippedUpdateCount += 1;
      }

      this.updateTimer = setTimeout(() => {
        this.rebuildEvents();
      }, 5000);
    }
  },

  setSelectedDate: function (date, options = {}) {
    const nextDate = this.startOfDay(date);
    this.selectedDate = nextDate;

    if (options.syncVisibleMonth !== false) {
      this.visibleMonthStart = this.startOfMonth(nextDate);
    }

    this.updateDom(120);

    if (options.notify !== false) {
      const payload = nextDate.toISOString();
      this.sendNotification("DAILY_SCHEDULE_SET_DATE", payload);
      this.sendNotification("CALENDAR_DAY_DETAILS_SET_DATE", payload);
    }
  },

  changeMonth: function (delta) {
    this.visibleMonthStart = this.addMonths(this.visibleMonthStart, delta);
    this.updateDom(120);
  },

  setVisibleMonth: function (monthIndex, year) {
    const nextMonth = new Date(year, monthIndex, 1);
    nextMonth.setHours(0, 0, 0, 0);
    this.visibleMonthStart = nextMonth;
    this.updateDom(120);
  },

  jumpToToday: function () {
    this.setSelectedDate(new Date(), { syncVisibleMonth: true, notify: true });
  },

  getEventsForDate: function (date) {
    const dayStart = this.startOfDay(date);
    const dayEnd = this.endOfDay(date);

    return this.events.filter((event) => event.endDate > dayStart && event.startDate < dayEnd);
  },

  getEventColor: function (event) {
    return event.color || "#7c8aa7";
  },

  formatEventChip: function (event) {
    if (event.fullDayEvent) {
      return event.title || "Untitled event";
    }

    const timeLabel = new Date(event.startDate).toLocaleTimeString(config.language, {
      hour: "numeric",
      minute: "2-digit"
    }).replace(":00", "");

    return `${timeLabel} ${event.title || "Untitled event"}`;
  },

  buildToolbar: function () {
    const toolbar = createElement("div", { className: "monthly-calendar-toolbar" });

    const previous = createElement("button", {
      type: "button",
      className: "monthly-calendar-nav monthly-calendar-nav-prev",
      innerText: "\u2039"
    });
    previous.setAttribute("aria-label", "Previous month");
    previous.addEventListener("click", () => this.changeMonth(-1));

    const title = createElement("div", { className: "monthly-calendar-title" });
    const monthSelect = createElement("select", { className: "monthly-calendar-select monthly-calendar-select-month" });
    const yearSelect = createElement("select", { className: "monthly-calendar-select monthly-calendar-select-year" });

    this.getMonthOptions().forEach((month) => {
      const option = createElement("option", {
        value: String(month.value),
        innerText: month.label
      });
      if (month.value === this.visibleMonthStart.getMonth()) {
        option.selected = true;
      }
      monthSelect.appendChild(option);
    });

    this.getYearOptions().forEach((year) => {
      const option = createElement("option", {
        value: String(year),
        innerText: String(year)
      });
      if (year === this.visibleMonthStart.getFullYear()) {
        option.selected = true;
      }
      yearSelect.appendChild(option);
    });

    const handleSelectChange = () => {
      this.setVisibleMonth(Number(monthSelect.value), Number(yearSelect.value));
    };

    monthSelect.addEventListener("change", handleSelectChange);
    yearSelect.addEventListener("change", handleSelectChange);

    title.appendChild(monthSelect);
    title.appendChild(yearSelect);

    const today = createElement("button", {
      type: "button",
      className: "monthly-calendar-today",
      innerText: "Today"
    });
    today.addEventListener("click", () => this.jumpToToday());

    const next = createElement("button", {
      type: "button",
      className: "monthly-calendar-nav monthly-calendar-nav-next",
      innerText: "\u203A"
    });
    next.setAttribute("aria-label", "Next month");
    next.addEventListener("click", () => this.changeMonth(1));

    toolbar.appendChild(previous);
    toolbar.appendChild(title);
    toolbar.appendChild(today);
    toolbar.appendChild(next);
    return toolbar;
  },

  buildWeekdayRow: function () {
    const row = createElement("div", { className: "monthly-calendar-weekdays" });
    const start = this.getConfiguredWeekStart();
    const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    for (let index = 0; index < 7; index += 1) {
      const labelIndex = (start + index) % 7;
      row.appendChild(createElement("div", {
        className: "monthly-calendar-weekday",
        innerText: labels[labelIndex]
      }));
    }

    return row;
  },

  buildEventChip: function (event) {
    const chip = createElement("div", {
      className: "monthly-calendar-event",
      innerText: this.formatEventChip(event)
    });
    chip.style.setProperty("--event-color", this.getEventColor(event));
    return chip;
  },

  buildDateCell: function (date) {
    const cell = createElement("button", {
      type: "button",
      className: "monthly-calendar-cell"
    });
    const dayDate = this.startOfDay(date);
    const today = this.startOfDay(new Date());
    const isOtherMonth = dayDate.getMonth() !== this.visibleMonthStart.getMonth();
    const isSelected = dayDate.valueOf() === this.selectedDate.valueOf();
    const isToday = dayDate.valueOf() === today.valueOf();

    if (isOtherMonth) {
      cell.classList.add("other-month");
    }

    if (isSelected) {
      cell.classList.add("selected");
    }

    if (isToday) {
      cell.classList.add("today");
    }

    const label = createElement("div", {
      className: "monthly-calendar-date",
      innerText: date.getDate()
    });
    cell.appendChild(label);

    const eventsWrap = createElement("div", { className: "monthly-calendar-events" });
    const events = this.getEventsForDate(dayDate);
    const visibleEvents = events.slice(0, this.config.maxEventsPerDay);

    visibleEvents.forEach((event) => {
      eventsWrap.appendChild(this.buildEventChip(event));
    });

    cell.appendChild(eventsWrap);

    if (events.length > visibleEvents.length) {
      cell.appendChild(createElement("div", {
        className: "monthly-calendar-more",
        innerText: `+${events.length - visibleEvents.length} more`
      }));
    }

    cell.addEventListener("click", () => {
      this.setSelectedDate(dayDate, { syncVisibleMonth: true, notify: true });
    });

    return cell;
  },

  buildGrid: function () {
    const grid = createElement("div", { className: "monthly-calendar-grid" });
    this.getVisibleMonthDays().forEach((date) => {
      grid.appendChild(this.buildDateCell(date));
    });
    return grid;
  },

  attachSwipeHandlers: function (wrapper) {
    wrapper.addEventListener("touchstart", (event) => {
      const touch = event.touches && event.touches[0];
      if (!touch) {
        return;
      }
      this.touchStartX = touch.clientX;
      this.touchStartY = touch.clientY;
    }, { passive: true });

    wrapper.addEventListener("touchend", (event) => {
      const touch = event.changedTouches && event.changedTouches[0];
      if (!touch || this.touchStartY === null || this.touchStartX === null) {
        return;
      }

      const deltaY = touch.clientY - this.touchStartY;
      const deltaX = touch.clientX - this.touchStartX;
      this.touchStartX = null;
      this.touchStartY = null;

      if (Math.abs(deltaX) < this.config.swipeThreshold || Math.abs(deltaX) < Math.abs(deltaY)) {
        return;
      }

      if (deltaX < 0) {
        this.changeMonth(1);
      } else {
        this.changeMonth(-1);
      }
    }, { passive: true });
  },

  getDom: function () {
    const wrapper = createElement("div", { className: "monthly-calendar-shell" });
    wrapper.appendChild(this.buildToolbar());
    wrapper.appendChild(this.buildWeekdayRow());
    wrapper.appendChild(this.buildGrid());
    this.attachSwipeHandlers(wrapper);
    return wrapper;
  }
});
