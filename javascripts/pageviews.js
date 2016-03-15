/*
 * Pageviews Analysis tool
 *
 * Original code forked from https://gist.github.com/marcelrf/49738d14116fd547fe6d courtesy of marcelrf
 *
 * Copyright 2016 MusikAnimal
 * Redistributed under the MIT License: https://opensource.org/licenses/MIT
 */

const config = require('./config');
const siteMap = require('./shared/site_map');
const siteDomains = Object.keys(siteMap).map(key => siteMap[key]);
const pv = require('./shared/pv');
let session = require('./session'),
  colorsStyleEl, daterangepicker;

/** let's us know if the page names have been normalized via the API yet */
let normalized = false;

/**
 * Select2 library prints "Uncaught TypeError: XYZ is not a function" errors
 * caused by race conditions between consecutive ajax calls. They are actually
 * not critical and can be avoided with this empty function.
 * @param {Object} data - doesn't matter
 * @returns {null} nothing
 */
function articleSuggestionCallback(data) {}
window.articleSuggestionCallback = articleSuggestionCallback;

/**
 * Destroy previous chart, if needed.
 * @returns {null} nothing
 */
function destroyChart() {
  if (session.chartObj) {
    session.chartObj.destroy();
    delete session.chartObj;
  }
}

/**
 * Exports current chart data to CSV format and loads it in a new tab
 * With the prepended data:text/csv this should cause the browser to download the data
 * @returns {string} CSV content
 */
function exportCSV() {
  let csvContent = 'data:text/csv;charset=utf-8,Date,';
  let titles = [];
  let dataRows = [];
  let dates = getDateHeadings(false);

  // Begin constructing the dataRows array by populating it with the dates
  dates.forEach((date, index) => {
    dataRows[index] = [date];
  });

  chartData.forEach(page => {
    // Build an array of page titles for use in the CSV header
    let pageTitle = '"' + page.label.replace(/"/g, '""') + '"';
    titles.push(pageTitle);

    // Populate the dataRows array with the data for this page
    dates.forEach((date, index) => {
      dataRows[index].push(page.data[index]);
    });
  });

  // Finish the CSV header
  csvContent = csvContent + titles.join(',') + '\n';

  // Add the rows to the CSV
  dataRows.forEach(data => {
    csvContent += data.join(',') + '\n';
  });

  // Output the CSV file to the browser
  const encodedUri = encodeURI(csvContent);
  window.open(encodedUri);
}

/**
 * Exports current chart data to JSON format and loads it in a new tab
 * @returns {string} stringified JSON
 */
function exportJSON() {
  let data = [];

  chartData.forEach((page, index) => {
    let entry = {
      page: page.label.replace(/"/g, '\"').replace(/'/g, "\'"),
      color: page.strokeColor,
      sum: page.sum,
      daily_average: Math.round(page.sum / numDaysInRange())
    };

    getDateHeadings(false).forEach((heading, index) => {
      entry[heading.replace(/\\/,'')] = page.data[index];
    });

    data.push(entry);
  });

  const jsonContent = 'data:text/json;charset=utf-8,' + JSON.stringify(data),
    encodedUri = encodeURI(jsonContent);
  window.open(encodedUri);

  return jsonContent;
}

/**
 * Fill in values within settings modal with what's in the session object
 * @returns {null} nothing
 */
function fillInSettings() {
  $.each($('#settings-modal input'), function() {
    let name = $(this).prop('name');

    if ($(this).prop('type') === 'checkbox') {
      $(this).prop('checked', session[name] === 'true');
    } else {
      $(this).prop('checked', session[name] === $(this).val());
    }
  });
}

/**
 * Fills in zero value to a timeseries, see:
 * https://wikitech.wikimedia.org/wiki/Analytics/AQS/Pageview_API#Gotchas
 *
 * @param {object} data fetched from API
 * @param {moment} startDate - start date of range to filter through
 * @param {moment} endDate - end date of range
 * @returns {object} dataset with zeros where nulls where
 */
function fillInZeros(data, startDate, endDate) {
  /** Extract the dates that are already in the timeseries */
  let alreadyThere = {};
  data.items.forEach(elem => {
    let date = moment(elem.timestamp, config.timestampFormat);
    alreadyThere[date] = elem;
  });
  data.items = [];

  /** Reconstruct with zeros instead of nulls */
  for (let date = moment(startDate); date <= endDate; date.add(1, 'd')) {
    if (alreadyThere[date]) {
      data.items.push(alreadyThere[date]);
    } else {
      let edgeCase = endDate.isSame(config.maxDate) || endDate.isSame(config.maxDate.subtract(1, 'days'));
      data.items.push({
        timestamp: date.format(config.timestampFormat),
        views: edgeCase ? null : 0
      });
    }
  }
}

/**
 * Format number based on current settings, e.g. localize with comma delimeters
 * @param {number|string} num - number to format
 * @returns {string} formatted number
 */
function formatNumber(num) {
  if (session.numericalFormatting === 'true') {
    return pv.n(num);
  } else {
    return num;
  }
}
/** need to export to global for chart templating */
window.formatNumber = formatNumber;

/**
 * Get data formatted for a circular chart (Pie, Doughnut, PolarArea)
 *
 * @param {object} data - data just before we are ready to render the chart
 * @param {string} article - title of page
 * @param {integer} index - where we are in the list of pages to show
 *    used for colour selection
 * @returns {object} - ready for chart rendering
 */
function getCircularData(data, article, index) {
  const values = data.items.map(elem => elem.views),
    color = config.colors[index];

  return Object.assign(
    {
      label: article.replace(/_/g, ' '),
      value: values.reduce((a, b) => a + b)
    },
    config.chartConfig[session.chartType].dataset(color)
  );
}

/**
 * Get date format to use based on settings
 * @returns {string} date format to passed to parser
 */
function getDateFormat() {
  if (session.localizeDateFormat === 'true') {
    return pv.getLocaleDateString();
  } else {
    return config.defaults.dateFormat;
  }
}

/**
 * Gets the date headings as strings - i18n compliant
 * @param {boolean} localized - whether the dates should be localized per browser language
 * @returns {Array} the date headings as strings
 */
function getDateHeadings(localized) {
  const dateHeadings = [];

  for (let date = moment(daterangepicker.startDate); date.isBefore(daterangepicker.endDate); date.add(1, 'd')) {
    if (localized) {
      dateHeadings.push(date.format(getDateFormat()));
    } else {
      dateHeadings.push(date.format('YYYY-MM-DD'));
    }
  }
  return dateHeadings;
}

/**
 * Get data formatted for a linear chart (Line, Bar, Radar)
 *
 * @param {object} data - data just before we are ready to render the chart
 * @param {string} article - title of page
 * @param {integer} index - where we are in the list of pages to show
 *    used for colour selection
 * @returns {object} - ready for chart rendering
 */
function getLinearData(data, article, index) {
  const values = data.items.map(elem => elem.views),
    color = config.colors[index % 10];

  return Object.assign(
    {
      label: article.replace(/_/g, ' '),
      data: values,
      sum: values.reduce((a, b) => a + b)
    },
    config.chartConfig[session.chartType].dataset(color)
  );
}

/**
 * Construct query for API based on what type of search we're doing
 * @param {Object} query - as returned from Select2 input
 * @returns {Object} query params to be handed off to API
 */
function getSearchParams(query) {
  if (session.autocomplete === 'autocomplete') {
    return {
      'action': 'query',
      'list': 'prefixsearch',
      'format': 'json',
      'pssearch': query || '',
      'cirrusUseCompletionSuggester': 'yes'
    };
  } else if (session.autocomplete === 'autocomplete_redirects') {
    return {
      'action': 'opensearch',
      'format': 'json',
      'search': query || '',
      'redirects': 'return'
    };
  }
}

/**
 * Compute how many days are in the selected date range
 *
 * @returns {integer} number of days
 */
function numDaysInRange() {
  return daterangepicker.endDate.diff(daterangepicker.startDate, 'days') + 1;
}
/** must be global for use in Chart templates */
window.numDaysInRange = numDaysInRange;

/**
 * Generate key/value pairs of URL hash params
 * @returns {Object} key/value pairs representation of URL hash
 */
function parseHashParams() {
  const uri = decodeURI(location.hash.slice(1)),
    chunks = uri.split('&');
  let params = {};

  for (let i = 0; i < chunks.length; i++) {
    let chunk = chunks[i].split('=');

    if (chunk[0] === 'pages') {
      params.pages = chunk[1].split('|');
    } else {
      params[chunk[0]] = chunk[1];
    }
  }

  return params;
}

/**
 * Parses the URL hash and sets all the inputs accordingly
 * Should only be called on initial page load, until we decide to support pop states (probably never)
 * @returns {null} nothing
 */
function popParams() {
  let startDate, endDate, params = parseHashParams();

  $(config.projectInput).val(params.project || config.defaults.project);
  if (validateProject()) return;

  /**
   * sets date range based on start/end params, or uses defaults
   * @return {null} nothing
   */
  const setDefaultDateRange = () => {
    startDate = moment(params.start || moment().subtract(config.daysAgo, 'days'));
    endDate = moment(params.end || Date.now());
    if (startDate < moment('2015-10-01') || endDate < moment('2015-10-01')) {
      pv.addSiteNotice('danger', i18nMessages.paramError1, i18nMessages.invalidParams, true);
      resetView();
      return;
    } else if (startDate > endDate) {
      pv.addSiteNotice('warning', i18nMessages.paramError2, i18nMessages.invalidParams, true);
      resetView();
      return;
    }
    /** directly assign startDate before calling setEndDate so events will be fired once */
    daterangepicker.startDate = startDate;
    daterangepicker.setEndDate(endDate);
  };

  /**
   * Check if we're using a valid range, and if so ignore any start/end dates.
   * If an invalid range, throw and error and use default dates.
   */
  if (params.range) {
    if (!setSpecialRange(params.range)) {
      pv.addSiteNotice('danger', i18nMessages.paramError3, i18nMessages.invalidParams, true);
      setDefaultDateRange();
    }
  } else {
    setDefaultDateRange();
  }

  $('#platform-select').val(params.platform || 'all-access');
  $('#agent-select').val(params.agent || 'user');

  resetArticleSelector();

  if (!params.pages || params.pages.length === 1 && !params.pages[0]) {
    params.pages = ['Cat', 'Dog'];
    setArticleSelectorDefaults(params.pages);
  } else if (normalized) {
    params.pages = pv.underscorePageNames(params.pages);
    setArticleSelectorDefaults(params.pages);
  } else {
    pv.normalizePageNames(params.pages).then(data => {
      normalized = true;

      params.pages = data;

      if (params.pages.length === 1) {
        session.chartType = localStorage['pageviews-chart-preference'] || 'Bar';
      }

      setArticleSelectorDefaults(pv.underscorePageNames(params.pages));
    });
  }
}

/**
 * Processes Mediawiki API results into Select2 format based on settings
 * @param {Object} data - data as received from the API
 * @returns {Object} data ready to handed over to Select2
 */
function processSearchResults(data) {
  let results = [];

  if (session.autocomplete === 'autocomplete') {
    if (data && data.query && data.query.prefixsearch.length) {
      results = data.query.prefixsearch.map(function(elem) {
        return {
          id: elem.title.replace(/ /g, '_'),
          text: elem.title
        };
      });
    }
  } else if (session.autocomplete === 'autocomplete_redirects') {
    if (data && data[1].length) {
      results = data[1].map(elem => {
        return {
          id: elem.replace(/ /g, '_'),
          text: elem
        };
      });
    }
  }

  return {results: results};
}

/**
 * Replaces history state with new URL hash representing current user input
 * Called whenever we go to update the chart
 * @returns {string} the new hash param string
 */
function pushParams() {
  const pages = $(config.articleSelector).select2('val') || [];

  let state = {
    project: $(config.projectInput).val(),
    platform: $('#platform-select').val(),
    agent: $('#agent-select').val()
  };

  /**
   * Override start and end with custom range values, if configured (set by URL params or setupDateRangeSelector)
   * Valid values are those defined in config.specialRanges, constructed like `{range: 'last-month'}`,
   *   or a relative range like `{range: 'latest-N'}` where N is the number of days.
   */
  if (session.specialRange) {
    state.range = session.specialRange.range;
  } else {
    state.start = daterangepicker.startDate.format('YYYY-MM-DD');
    state.end = daterangepicker.endDate.format('YYYY-MM-DD');
  }

  if (window.history && window.history.replaceState) {
    window.history.replaceState({}, 'Pageviews comparsion', `#${$.param(state)}&pages=${pages.join('|')}`);
  }

  return state;
}

/**
 * Removes all article selector related stuff then adds it back
 * Also calls updateChart
 * @returns {null} nothing
 */
function resetArticleSelector() {
  const articleSelector = $(config.articleSelector);
  articleSelector.off('change');
  articleSelector.select2('val', null);
  articleSelector.select2('data', null);
  articleSelector.select2('destroy');
  $('.data-links').hide();
  setupArticleSelector();
}

/**
 * Removes chart, messages, and resets article selections
 * @returns {null} nothing
 */
function resetView() {
  $('.chart-container').html('');
  $('.chart-container').removeClass('loading');
  $('#chart-legend').html('');
  $('.message-container').html('');
  resetArticleSelector();
}

/**
 * Save a particular setting to session and localStorage
 *
 * @param {string} key - settings key
 * @param {string|boolean} value - value to save
 * @returns {null} nothing
 */
function saveSetting(key, value) {
  session[key] = value;
  localStorage[`pageviews-settings-${key}`] = value;
}

/**
 * Save the selected settings within the settings modal
 * Prefer this implementation over a large library like serializeObject or serializeJSON
 * @returns {null} nothing
 */
function saveSettings() {
  /** track if we're changing to no_autocomplete mode */
  const wasAutocomplete = session.autocomplete === 'no_autocomplete';

  $.each($('#settings-modal input'), function() {
    if (this.type === 'checkbox') {
      saveSetting(this.name, this.checked ? 'true' : 'false');
    } else if (this.checked) {
      saveSetting(this.name, this.value);
    }
  });

  daterangepicker.locale.format = getDateFormat();
  daterangepicker.updateElement();
  setupSelect2Colors();

  /**
   * If we changed to/from no_autocomplete we have to reset the article selector entirely
   *   as setArticleSelectorDefaults is super buggy due to Select2 constraints
   * So let's only reset if we have to
   */
  if (session.autocomplete === 'no_autocomplete' !== wasAutocomplete) {
    resetArticleSelector();
  }

  updateChart(true);
}

/**
 * Directly set articles in article selector
 * Currently is not able to remove underscore from page names
 *
 * @param {array} pages - page titles
 * @returns {array} - untouched array of pages
 */
function setArticleSelectorDefaults(pages) {
  const articleSelectorQuery = config.articleSelector;
  pages.forEach(page => {
    const escapedText = $('<div>').text(page).html();
    $('<option>' + escapedText + '</option>').appendTo(articleSelectorQuery);
  });
  const articleSelector = $(articleSelectorQuery);
  articleSelector.select2('val', pages);
  articleSelector.select2('close');

  return pages;
}

/**
 * Sets the daterange picker values and session.specialRange based on provided special range key
 * WARNING: not to be called on daterange picker GUI events (e.g. special range buttons)
 *
 * @param {string} type - one of special ranges defined in config.specialRanges,
 *   including dynamic latest range, such as `latest-15` for latest 15 days
 * @returns {object|null} updated session.specialRange object or null if type was invalid
 */
function setSpecialRange(type) {
  const rangeIndex = Object.keys(config.specialRanges).indexOf(type);
  let startDate, endDate;

  if (type.includes('latest-')) {
    const offset = parseInt(type.replace('latest-', ''), 10) || 20; // fallback of 20
    [startDate, endDate] = config.specialRanges.latest(offset);
  } else if (rangeIndex >= 0) {
    [startDate, endDate] = config.specialRanges[type];
    $('.daterangepicker .ranges li').eq(rangeIndex).trigger('click');
  } else {
    return;
  }

  session.specialRange = {
    range: type,
    value: `${startDate.format(getDateFormat())} - ${endDate.format(getDateFormat())}`
  };

  /** directly assign startDate then use setEndDate so that the events will be fired once */
  daterangepicker.startDate = startDate;
  daterangepicker.setEndDate(endDate);

  return session.specialRange;
}

/**
 * Sets up the article selector and adds listener to update chart
 * @returns {null} - nothing
 */
function setupArticleSelector() {
  const articleSelector = $(config.articleSelector);

  let params = {
    ajax: getArticleSelectorAjax(),
    tags: session.autocomplete === 'no_autocomplete',
    placeholder: i18nMessages.articlePlaceholder,
    maximumSelectionLength: 10,
    minimumInputLength: 1
  };

  articleSelector.select2(params);
  articleSelector.on('change', updateChart);
}

/**
 * Get ajax parameters to be used in setupArticleSelector, based on session.autocomplete
 * @return {object|null} to be passed in as the value for `ajax` in setupArticleSelector
 */
function getArticleSelectorAjax() {
  if (session.autocomplete !== 'no_autocomplete') {
    /**
     * This ajax call queries the Mediawiki API for article name
     * suggestions given the search term inputed in the selector.
     * We ultimately want to make the endpoint configurable based on whether they want redirects
     */
    return {
      url: `https://${pv.getProject()}.org/w/api.php`,
      dataType: 'jsonp',
      delay: 200,
      jsonpCallback: 'articleSuggestionCallback',
      data: search => getSearchParams(search.term),
      processResults: processSearchResults,
      cache: true
    };
  } else {
    return null;
  }
}

/**
 * Attempt to fine-tune the pointer detection spacing based on how cluttered the chart is
 * @returns {null} nothing
 */
function setChartPointDetectionRadius() {
  if (session.chartType !== 'Line') return;

  if (numDaysInRange() > 50) {
    Chart.defaults.Line.pointHitDetectionRadius = 3;
  } else if (numDaysInRange() > 30) {
    Chart.defaults.Line.pointHitDetectionRadius = 5;
  } else if (numDaysInRange() > 20) {
    Chart.defaults.Line.pointHitDetectionRadius = 10;
  } else {
    Chart.defaults.Line.pointHitDetectionRadius = 20;
  }
}

/**
 * sets up the daterange selector and adds listeners
 * @returns {null} - nothing
 */
function setupDateRangeSelector() {
  const dateRangeSelector = $(config.dateRangeSelector);

  /** transform config.specialRanges to have i18n as keys */
  let ranges = {};
  Object.keys(config.specialRanges).forEach(key => {
    ranges[i18nMessages[key]] = config.specialRanges[key];
  });

  dateRangeSelector.daterangepicker({
    locale: {
      format: getDateFormat(),
      applyLabel: i18nMessages.apply,
      cancelLabel: i18nMessages.cancel,
      customRangeLabel: i18nMessages.customRange,
      daysOfWeek: [
        i18nMessages.su,
        i18nMessages.mo,
        i18nMessages.tu,
        i18nMessages.we,
        i18nMessages.th,
        i18nMessages.fr,
        i18nMessages.sa
      ],
      monthNames: [
        i18nMessages.january,
        i18nMessages.february,
        i18nMessages.march,
        i18nMessages.april,
        i18nMessages.may,
        i18nMessages.june,
        i18nMessages.july,
        i18nMessages.august,
        i18nMessages.september,
        i18nMessages.october,
        i18nMessages.november,
        i18nMessages.december
      ]
    },
    startDate: moment().subtract(config.daysAgo, 'days'),
    minDate: config.minDate,
    maxDate: config.maxDate,
    ranges: ranges
  });

  daterangepicker = dateRangeSelector.data('daterangepicker');

  /** so people know why they can't query data older than October 2015 */
  $('.daterangepicker').append(
    $('<div>')
      .addClass('daterange-notice')
      .html(i18nMessages.dateNotice)
  );

  /**
   * The special date range options (buttons the right side of the daterange picker)
   *
   * WARNING: we're unable to add class names or data attrs to the range options,
   * so checking which was clicked is hardcoded based on the index of the LI,
   * as defined in config.specialRanges
   */
  $('.daterangepicker .ranges li').on('click', e => {
    const index = $('.daterangepicker .ranges li').index(e.target),
      container = daterangepicker.container,
      inputs = container.find('.daterangepicker_input input');
    session.specialRange = {
      range: Object.keys(config.specialRanges)[index],
      value: `${inputs[0].value} - ${inputs[1].value}`
    };
  });

  /** the "Latest N days" links */
  $('.date-latest a').on('click', function(e) {
    setSpecialRange(`latest-${$(this).data('value')}`);
  });

  dateRangeSelector.on('apply.daterangepicker', (e, action) => {
    if (action.chosenLabel === i18nMessages.customRange) {
      session.specialRange = null;

      /** force events to re-fire since apply.daterangepicker occurs before 'change' event */
      daterangepicker.updateElement();
    }
  });

  dateRangeSelector.on('change', e => {
    setChartPointDetectionRadius();
    updateChart();

    /** clear out specialRange if it doesn't match our input */
    if (session.specialRange && session.specialRange.value !== e.target.value) {
      session.specialRange = null;
    }
  });
}

/**
 * General place to add page-wide listeners
 * @returns {null} - nothing
 */
function setupListeners() {
  $('.download-csv').on('click', exportCSV);
  $('.download-json').on('click', exportJSON);
  $('#platform-select, #agent-select').on('change', updateChart);

  /** changing of chart types */
  $('.modal-chart-type a').on('click', function() {
    session.chartType = $(this).data('type');
    localStorage['pageviews-chart-preference'] = session.chartType;
    updateChart();
  });

  /** language selector */
  $('.lang-link').on('click', function() {
    const expiryGMT = moment().add(config.cookieExpiry, 'days').toDate().toGMTString();
    document.cookie = `TsIntuition_userlang=${$(this).data('lang')}; expires=${expiryGMT}; path=/`;

    const expiryUnix = Math.floor(Date.now() / 1000) + (config.cookieExpiry * 24 * 60 * 60);
    document.cookie = `TsIntuition_expiry=${expiryUnix}; expires=${expiryGMT}; path=/`;
    location.reload();
  });

  /** prevent browser's default behaviour for any link with href="#" */
  $('a[href=\'#\'').on('click', e => e.preventDefault());

  // window.onpopstate = popParams();
}

/**
 * Setup listeners for project input
 * @returns {null} - nothing
 */
function setupProjectInput() {
  $(config.projectInput).on('change', function() {
    if (!this.value) {
      this.value = config.defaults.project;
      return;
    }
    if (validateProject()) return;
    resetView();
  });
}

/**
 * Setup colors for Select2 entries so we can dynamically change them
 * This is a necessary evil, as we have to mark them as !important
 *   and since there are any number of entires, we need to use nth-child selectors
 * @returns {CSSStylesheet} our new stylesheet
 */
function setupSelect2Colors() {
  /** first delete old stylesheet, if present */
  if (colorsStyleEl) colorsStyleEl.remove();

  /** create new stylesheet */
  colorsStyleEl = document.createElement('style');
  colorsStyleEl.appendChild(document.createTextNode('')); // WebKit hack :(
  document.head.appendChild(colorsStyleEl);

  /** add color rules */
  config.colors.forEach((color, index) => {
    colorsStyleEl.sheet.insertRule(`.select2-selection__choice:nth-of-type(${index + 1}) { background: ${color} !important }`, 0);
  });

  return colorsStyleEl.sheet;
}

/**
 * Set values of form based on localStorage or defaults, add listeners
 * @returns {null} nothing
 */
function setupSettingsModal() {
  /** fill in values, everything is either a checkbox or radio */
  fillInSettings();

  /** add listener */
  $('.save-settings-btn').on('click', saveSettings);
  $('.cancel-settings-btn').on('click', fillInSettings);
}

/**
 * The mother of all functions, where all the chart logic lives
 * Really needs to be broken out into several functions
 *
 * @param {boolean} force - whether to force the chart to re-render, even if no params have changed
 * @returns {null} - nothin
 */
function updateChart(force) {
  let articles = $(config.articleSelector).select2('val') || [];

  pushParams();

  /** prevent duplicate querying due to conflicting listeners */
  if (!force && location.hash === session.params && session.prevChartType === session.chartType) {
    return;
  }

  if (!articles.length) {
    resetView();
    return;
  }

  session.params = location.hash;
  session.prevChartType = session.chartType;

  /** Collect parameters from inputs. */
  const startDate = daterangepicker.startDate.startOf('day'),
    endDate = daterangepicker.endDate.startOf('day');

  destroyChart();
  $('.message-container').html('');
  $('.chart-container').addClass('loading');

  /**
   * Asynchronously collect the data from Analytics Query Service API,
   * process it to Chart.js format and initialize the chart.
   */
  let labels = []; // Labels (dates) for the x-axis.
  let datasets = []; // Data for each article timeseries.
  articles.forEach((article, index) => {
    const uriEncodedArticle = encodeURIComponent(article);
    /** Url to query the API. */
    const url = (
      `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${pv.getProject()}` +
      `/${$('#platform-select').val()}/${$('#agent-select').val()}/${uriEncodedArticle}/daily` +
      `/${startDate.format(config.timestampFormat)}/${endDate.format(config.timestampFormat)}`
    );

    $.ajax({
      url: url,
      dataType: 'json'
    }).success(data => {
      fillInZeros(data, startDate, endDate);

      /** Build the article's dataset. */
      if (config.linearCharts.includes(session.chartType)) {
        datasets.push(getLinearData(data, article, index));
      } else {
        datasets.push(getCircularData(data, article, index));
      }

      window.chartData = datasets;
    }).fail(data => {
      if (data.status === 404) {
        writeMessage(`No data found for the page <a href='${pv.getPageURL(article)}'>${article}</a>`, true);
        articles = articles.filter(el => el !== article);

        if (!articles.length) {
          $('.chart-container').html('');
          $('.chart-container').removeClass('loading');
        }
      }
    }).always(data => {
      /** Get the labels from the first call. */
      if (labels.length === 0 && data.items) {
        labels = data.items.map(elem => {
          return moment(elem.timestamp, config.timestampFormat).format(getDateFormat());
        });
      }

      /** When all article datasets have been collected, initialize the chart. */
      if (articles.length && datasets.length === articles.length) {
        $('.chart-container').removeClass('loading');
        const options = Object.assign({},
          config.chartConfig[session.chartType].opts,
          config.globalChartOpts
        );
        const linearData = {labels: labels, datasets: datasets};

        $('.chart-container').html('');
        $('.chart-container').append("<canvas class='aqs-chart'>");
        const context = $(config.chart)[0].getContext('2d');

        if (config.linearCharts.includes(session.chartType)) {
          session.chartObj = new Chart(context)[session.chartType](linearData, options);
        } else {
          session.chartObj = new Chart(context)[session.chartType](datasets, options);
        }

        $('#chart-legend').html(session.chartObj.generateLegend());
        $('.data-links').show();
      }
    });
  });
}

/**
 * Checks value of project input and validates it against site map
 * @returns {boolean} whether the currently input project is valid
 */
function validateProject() {
  const project = $(config.projectInput).val();
  if (siteDomains.includes(project)) {
    $('.validate').remove();
    $('.select2-selection--multiple').removeClass('disabled');
  } else {
    resetView();
    writeMessage(
      `<a href='//${project}'>${project}</a> is not a
       <a href='//meta.wikipedia.org/w/api.php?action=sitematrix&formatversion=2'>valid project</a>`,
       true
    );
    $('.select2-selection--multiple').addClass('disabled');
    return true;
  }
}

/**
 * Writes message just below the chart
 * @param {string} message - message to write
 * @param {boolean} clear - whether to clear any existing messages
 * @returns {jQuery} - jQuery object of message container
 */
function writeMessage(message, clear) {
  if (clear) {
    pv.clearMessages();
  }
  return $('.message-container').append(
    `<div class='error-message'>${message}</div>`
  );
}

$(document).ready(() => {
  /** assume query params are supposed to be hash params */
  if (document.location.search && !document.location.hash) {
    return document.location.href = document.location.href.replace('?', '#');
  } else if (document.location.search) {
    return document.location.href = document.location.href.replace(/\?.*/, '');
  }

  $.extend(Chart.defaults.global, {animation: false, responsive: true});

  setupProjectInput();
  setupDateRangeSelector();
  setupArticleSelector();
  setupSettingsModal();
  setupSelect2Colors();
  popParams();

  /** simple metric to see how many use it (pageviews of the pageview, a meta-pageview, if you will :) */
  $.ajax({
    url: `//tools.wmflabs.org/musikanimal/api/pv_uses/${pv.getProject()}`,
    method: 'PATCH'
  });

  /** temporary redirect notice from when tool was moved from /musikanimal/pageviews to /pageviews */
  if (document.location.search.includes('redirected=true')) {
    if (window.history && window.history.replaceState) {
      let newURL = document.location.href.replace(document.location.search, '');
      window.history.replaceState({}, 'Pageviews comparsion', newURL);
    }
    pv.addSiteNotice('info',
      `Please update your links to point to
       <a class='alert-link' href='//tools.wmflabs.org/pageviews'>tools.wmflabs.org/pageviews</a>`,
       'Pageviews Analysis has moved!'
    );
  }

  setupListeners();

  pv.splash();
});
