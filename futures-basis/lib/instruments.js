/* 国内期货品种元数据表（浏览器版，纯数据+parseContract，无 Node 依赖）
 * 移植自原 server/lib/instruments.js，仅把 module.exports 换成 window.Instruments。
 */
(function (global) {
  'use strict';

  var EXCHANGES = {
    SHFE: { code: 'SHFE', name: '上期所', cn: '上海期货交易所' },
    DCE: { code: 'DCE', name: '大商所', cn: '大连商品交易所' },
    CZCE: { code: 'CZCE', name: '郑商所', cn: '郑州商品交易所' },
    CFFEX: { code: 'CFFEX', name: '中金所', cn: '中国金融期货交易所' },
    INE: { code: 'INE', name: '上期能源', cn: '上海国际能源交易中心' },
    GFEX: { code: 'GFEX', name: '广期所', cn: '广州期货交易所' }
  };

  var ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  // [代码, 中文名, 交易所, 乘数, 单位, 月份模式, 起始年, 最后交易日规则]
  var RAW = [
    ['CU', '沪铜', 'SHFE', 5, '吨', [1,2,3,4,5,6,7,8,9,10,11,12], 2015, 'near15'],
    ['AL', '沪铝', 'SHFE', 5, '吨', ALL_MONTHS, 2015, 'near15'],
    ['ZN', '沪锌', 'SHFE', 5, '吨', ALL_MONTHS, 2015, 'near15'],
    ['PB', '沪铅', 'SHFE', 5, '吨', ALL_MONTHS, 2015, 'near15'],
    ['NI', '沪镍', 'SHFE', 1, '吨', ALL_MONTHS, 2015, 'near15'],
    ['SN', '沪锡', 'SHFE', 1, '吨', ALL_MONTHS, 2015, 'near15'],
    ['AU', '沪金', 'SHFE', 1000, '克', [2,4,6,8,10,12], 2015, 'near15'],
    ['AG', '沪银', 'SHFE', 15, '千克', ALL_MONTHS, 2015, 'near15'],
    ['RB', '螺纹钢', 'SHFE', 10, '吨', ALL_MONTHS, 2015, 'near15'],
    ['HC', '热卷', 'SHFE', 10, '吨', ALL_MONTHS, 2015, 'near15'],
    ['WR', '线材', 'SHFE', 10, '吨', ALL_MONTHS, 2015, 'near15'],
    ['SS', '不锈钢', 'SHFE', 5, '吨', ALL_MONTHS, 2019, 'near15'],
    ['FU', '燃油', 'SHFE', 10, '吨', ALL_MONTHS, 2015, 'near15'],
    ['BU', '沥青', 'SHFE', 10, '吨', ALL_MONTHS, 2015, 'near15'],
    ['RU', '天然橡胶', 'SHFE', 10, '吨', [1,3,4,5,6,7,8,9,10,11], 2015, 'near15'],
    ['SP', '纸浆', 'SHFE', 10, '吨', ALL_MONTHS, 2018, 'near15'],
    ['AO', '氧化铝', 'SHFE', 20, '吨', ALL_MONTHS, 2023, 'near15'],
    ['AD', '铸造铝合金', 'SHFE', 10, '吨', ALL_MONTHS, 2024, 'near15'],
    ['BR', '丁二烯橡胶', 'SHFE', 5, '吨', ALL_MONTHS, 2023, 'near15'],
    ['SC', '原油', 'INE', 1000, '桶', ALL_MONTHS, 2018, 'ine'],
    ['LU', '低硫燃油', 'INE', 10, '吨', ALL_MONTHS, 2020, 'near15'],
    ['NR', '20号胶', 'INE', 10, '吨', ALL_MONTHS, 2019, 'near15'],
    ['BC', '国际铜', 'INE', 5, '吨', ALL_MONTHS, 2020, 'near15'],
    ['EC', '集运欧线', 'INE', 50, '点', [2,4,6,8,10,12], 2023, 'near15'],
    ['A', '豆一', 'DCE', 10, '吨', [1,3,5,7,9,11], 2015, 'nth10'],
    ['B', '豆二', 'DCE', 10, '吨', ALL_MONTHS, 2015, 'nth10'],
    ['M', '豆粕', 'DCE', 10, '吨', ALL_MONTHS, 2015, 'nth10'],
    ['Y', '豆油', 'DCE', 10, '吨', ALL_MONTHS, 2015, 'nth10'],
    ['P', '棕榈油', 'DCE', 10, '吨', ALL_MONTHS, 2015, 'nth10'],
    ['C', '玉米', 'DCE', 10, '吨', ALL_MONTHS, 2015, 'nth10'],
    ['CS', '玉米淀粉', 'DCE', 10, '吨', ALL_MONTHS, 2015, 'nth10'],
    ['JD', '鸡蛋', 'DCE', 5, '吨', ALL_MONTHS, 2015, 'nth10'],
    ['RR', '粳米', 'DCE', 10, '吨', ALL_MONTHS, 2019, 'nth10'],
    ['L', '塑料', 'DCE', 5, '吨', ALL_MONTHS, 2015, 'nth10'],
    ['V', 'PVC', 'DCE', 5, '吨', ALL_MONTHS, 2015, 'nth10'],
    ['PP', '聚丙烯', 'DCE', 5, '吨', ALL_MONTHS, 2015, 'nth10'],
    ['J', '焦炭', 'DCE', 100, '吨', ALL_MONTHS, 2015, 'nth10'],
    ['JM', '焦煤', 'DCE', 60, '吨', ALL_MONTHS, 2015, 'nth10'],
    ['I', '铁矿石', 'DCE', 100, '吨', ALL_MONTHS, 2015, 'nth10'],
    ['EG', '乙二醇', 'DCE', 10, '吨', ALL_MONTHS, 2018, 'nth10'],
    ['EB', '苯乙烯', 'DCE', 5, '吨', ALL_MONTHS, 2019, 'nth10'],
    ['PG', 'LPG', 'DCE', 20, '吨', ALL_MONTHS, 2020, 'nth10'],
    ['LH', '生猪', 'DCE', 16, '吨', ALL_MONTHS, 2021, 'nth10'],
    ['FB', '纤维板', 'DCE', 500, '张', ALL_MONTHS, 2015, 'nth10'],
    ['BB', '胶合板', 'DCE', 500, '张', ALL_MONTHS, 2015, 'nth10'],
    ['SR', '白糖', 'CZCE', 10, '吨', [1,3,5,7,9,11], 2015, 'nth10'],
    ['CF', '棉花', 'CZCE', 5, '吨', [1,3,5,7,9,11], 2015, 'nth10'],
    ['CY', '棉纱', 'CZCE', 5, '吨', ALL_MONTHS, 2017, 'nth10'],
    ['TA', 'PTA', 'CZCE', 5, '吨', ALL_MONTHS, 2015, 'nth10'],
    ['MA', '甲醇', 'CZCE', 10, '吨', ALL_MONTHS, 2015, 'nth10'],
    ['FG', '玻璃', 'CZCE', 20, '吨', ALL_MONTHS, 2015, 'nth10'],
    ['SA', '纯碱', 'CZCE', 20, '吨', ALL_MONTHS, 2019, 'nth10'],
    ['SH', '烧碱', 'CZCE', 30, '吨', ALL_MONTHS, 2023, 'nth10'],
    ['OI', '菜油', 'CZCE', 10, '吨', [1,3,5,7,9,11], 2015, 'nth10'],
    ['RM', '菜粕', 'CZCE', 10, '吨', ALL_MONTHS, 2015, 'nth10'],
    ['RS', '油菜籽', 'CZCE', 10, '吨', [7,8,9,11], 2015, 'nth10'],
    ['SF', '硅铁', 'CZCE', 5, '吨', ALL_MONTHS, 2015, 'nth10'],
    ['SM', '锰硅', 'CZCE', 5, '吨', ALL_MONTHS, 2015, 'nth10'],
    ['UR', '尿素', 'CZCE', 20, '吨', ALL_MONTHS, 2019, 'nth10'],
    ['AP', '苹果', 'CZCE', 10, '吨', [1,3,4,5,10,11,12], 2017, 'nth10'],
    ['CJ', '红枣', 'CZCE', 5, '吨', [1,3,5,7,9,12], 2019, 'nth10'],
    ['PF', '短纤', 'CZCE', 5, '吨', ALL_MONTHS, 2020, 'nth10'],
    ['PK', '花生', 'CZCE', 5, '吨', [1,3,4,10,11,12], 2021, 'nth10'],
    ['PX', '对二甲苯', 'CZCE', 5, '吨', ALL_MONTHS, 2023, 'nth10'],
    ['PR', '瓶片', 'CZCE', 15, '吨', ALL_MONTHS, 2024, 'nth10'],
    ['ZC', '动力煤', 'CZCE', 100, '吨', ALL_MONTHS, 2015, 'nth10'],
    ['JR', '粳稻', 'CZCE', 20, '吨', [1,3,5,7,9,11], 2015, 'nth10'],
    ['PM', '普麦', 'CZCE', 50, '吨', [1,3,5,7,9,11], 2015, 'nth10'],
    ['WH', '强麦', 'CZCE', 20, '吨', [1,3,5,7,9,11], 2015, 'nth10'],
    ['RI', '早籼稻', 'CZCE', 20, '吨', [1,3,5,7,9,11], 2015, 'nth10'],
    ['LR', '晚籼稻', 'CZCE', 20, '吨', [1,3,5,7,9,11], 2015, 'nth10'],
    ['IF', '沪深300股指', 'CFFEX', 300, '点', [1,2,3,4,5,6,7,8,9,10,11,12], 2015, 'fri3'],
    ['IH', '上证50股指', 'CFFEX', 300, '点', ALL_MONTHS, 2015, 'fri3'],
    ['IC', '中证500股指', 'CFFEX', 200, '点', ALL_MONTHS, 2015, 'fri3'],
    ['IM', '中证1000股指', 'CFFEX', 200, '点', ALL_MONTHS, 2022, 'fri3'],
    ['T', '十债', 'CFFEX', 10000, '元', [3,6,9,12], 2015, 'fri2'],
    ['TF', '五债', 'CFFEX', 10000, '元', [3,6,9,12], 2015, 'fri2'],
    ['TS', '二债', 'CFFEX', 20000, '元', [3,6,9,12], 2018, 'fri2'],
    ['TL', '三十债', 'CFFEX', 10000, '元', [3,6,9,12], 2023, 'fri2'],
    ['SI', '工业硅', 'GFEX', 5, '吨', ALL_MONTHS, 2022, 'near15'],
    ['LC', '碳酸锂', 'GFEX', 1, '吨', ALL_MONTHS, 2023, 'near15'],
    ['PS', '多晶硅', 'GFEX', 3, '吨', ALL_MONTHS, 2025, 'near15'],
    ['PD', '钯', 'GFEX', 1000, '克', ALL_MONTHS, 2025, 'near15'],
    ['PT', '铂', 'GFEX', 1000, '克', ALL_MONTHS, 2025, 'near15']
  ];

  // 股指期货 -> 现货指数（腾讯代码），用于期现基差模块
  var INDEX_SPOT = {
    IF: { code: 'sh000300', name: '沪深300' },
    IH: { code: 'sh000016', name: '上证50' },
    IC: { code: 'sh000905', name: '中证500' },
    IM: { code: 'sh000852', name: '中证1000' }
  };

  var BY_CODE = {};
  var LIST = RAW.map(function (r) {
    var o = {
      code: r[0], name: r[1], ex: r[2], mult: r[3], unit: r[4],
      months: r[5], since: r[6], settleRule: r[7],
      exName: EXCHANGES[r[2]] ? EXCHANGES[r[2]].name : r[2],
      isFinancial: r[2] === 'CFFEX',
      spot: INDEX_SPOT[r[0]] || null
    };
    BY_CODE[o.code] = o;
    return o;
  });

  /** 从合约代码（如 AG2610 / MA2609）解析出品种代码与交割年月 */
  function parseContract(symbol) {
    var m = /^([A-Za-z]{1,3})(\d{3,4})$/.exec(symbol);
    if (!m) return null;
    var p = m[1].toUpperCase();
    var ym = m[2];
    var year, month;
    if (ym.length === 4) {
      year = 2000 + parseInt(ym.slice(0, 2), 10);
      month = parseInt(ym.slice(2), 10);
    } else {
      year = 2000 + parseInt(ym[0], 10);
      var nowY = new Date().getFullYear();
      while (year < nowY - 3) year += 10;
      month = parseInt(ym.slice(1), 10);
    }
    if (month < 1 || month > 12) return null;
    return { product: p, symbol: p + String(year % 100).padStart(2, '0') + String(month).padStart(2, '0'), year: year, month: month };
  }

  /** 生成合约代码（4 位 YYMM） */
  function makeSymbol(product, year, month) {
    return product.toUpperCase() + String(year % 100).padStart(2, '0') + String(month).padStart(2, '0');
  }

  function monthDiff(a, b) {
    return (a.year * 12 + a.month) - (b.year * 12 + b.month);
  }

  global.Instruments = {
    EXCHANGES: EXCHANGES, LIST: LIST, BY_CODE: BY_CODE, INDEX_SPOT: INDEX_SPOT,
    parseContract: parseContract, makeSymbol: makeSymbol, monthDiff: monthDiff, ALL_MONTHS: ALL_MONTHS
  };
})(typeof window !== 'undefined' ? window : this);
