import type { FetchContext, TenderRecord, TenderSource } from "./types.js";

const ITEMS: { title: string; okpd2: string; ktru?: string }[] = [
  { title: "Поставка компьютерного оборудования", okpd2: "26.20.15.000", ktru: "26.20.15.000-00000027" },
  { title: "Поставка ноутбуков", okpd2: "26.20.11.110", ktru: "26.20.11.110-00000138" },
  { title: "Поставка мониторов", okpd2: "26.20.17.110", ktru: "26.20.17.110-00000034" },
  { title: "Оказание услуг по разработке программного обеспечения", okpd2: "62.01.11.000" },
  { title: "Техническое обслуживание информационных систем", okpd2: "62.02.30.000" },
  { title: "Поставка бумаги для офисной техники", okpd2: "17.12.14.129", ktru: "17.12.14.129-00000001" },
  { title: "Капитальный ремонт кровли здания", okpd2: "43.91.19.110" },
  { title: "Строительство автомобильной дороги", okpd2: "42.11.10.120" },
  { title: "Поставка лекарственного препарата", okpd2: "21.20.10.232", ktru: "21.20.10.232-000029-1-00001" },
  { title: "Поставка медицинских перчаток", okpd2: "22.19.60.119", ktru: "22.19.60.119-00000006" },
  { title: "Оказание услуг по уборке помещений", okpd2: "81.21.10.000" },
  { title: "Поставка продуктов питания (молочная продукция)", okpd2: "10.51.11.111" },
  { title: "Поставка бензина автомобильного", okpd2: "19.20.21.125", ktru: "19.20.21.125-00000003" },
  { title: "Оказание услуг охраны", okpd2: "80.10.12.000" },
  { title: "Поставка мебели офисной", okpd2: "31.01.12.110", ktru: "31.01.12.110-00000003" },
];

const CUSTOMERS: { name: string; inn: string }[] = [
  { name: "ГБУЗ «Городская клиническая больница № 1»", inn: "7701234567" },
  { name: "Администрация муниципального образования", inn: "5003012345" },
  { name: "МБОУ «Средняя общеобразовательная школа № 15»", inn: "6658123456" },
  { name: "ФГБОУ ВО «Государственный университет»", inn: "7801987654" },
  { name: "ГКУ «Управление автомобильных дорог»", inn: "1655098765" },
  { name: "АО «Энергосбытовая компания»", inn: "2310045678" },
  { name: "ПАО «Региональные сети»", inn: "5406123987" },
  { name: "ГАУЗ «Областная детская больница»", inn: "6315567890" },
];

const PROCEDURES = ["Электронный аукцион", "Запрос котировок в электронной форме", "Открытый конкурс в электронной форме"];

function rng(seed: number) {
  let s = Math.imul(seed, 2654435761) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

/** Deterministic fake tenders for local development without access to zakupki.gov.ru. */
export class MockSource implements TenderSource {
  name = "mock";
  constructor(private count = 150) {}

  async *fetch(_ctx: FetchContext): AsyncIterable<TenderRecord> {
    const now = Date.now();
    const day = 86_400_000;
    for (let i = 0; i < this.count; i++) {
      const r = rng(i + 1);
      const item = ITEMS[Math.floor(r() * ITEMS.length)]!;
      const customer = CUSTOMERS[Math.floor(r() * CUSTOMERS.length)]!;
      const law = r() < 0.7 ? "44" : "223";
      const regNumber = law === "44" ? `0373${String(260000000000000 + i)}` : String(32600000000 + i);
      const published = new Date(now - Math.floor(r() * 10) * day);
      const deadline = new Date(published.getTime() + (3 + Math.floor(r() * 20)) * day + 7 * 3600_000);
      const price = (Math.round(r() * 50_000_000) + 50_000).toFixed(2);
      yield {
        regNumber,
        law,
        title: item.title,
        procedureType: law === "44" ? PROCEDURES[Math.floor(r() * PROCEDURES.length)]! : "Запрос предложений",
        stage: "Подача заявок",
        customerName: customer.name,
        customerInn: customer.inn,
        regionCode: customer.inn.slice(0, 2),
        maxPrice: price,
        currency: "RUB",
        publishedAt: published,
        sourceUpdatedAt: published,
        submissionDeadline: deadline,
        url:
          law === "44"
            ? `https://zakupki.gov.ru/epz/order/notice/ea20/view/common-info.html?regNumber=${regNumber}`
            : `https://zakupki.gov.ru/epz/order/notice/notice223/common-info.html?regNumber=${regNumber}`,
        okpd2Codes: [item.okpd2],
        ktruCodes: item.ktru ? [item.ktru] : [],
        details: {
          "Наименование объекта закупки": item.title,
          "Способ определения поставщика": PROCEDURES[0]!,
          "Заказчик": customer.name,
          "ИНН": customer.inn,
          "Источник данных": "Тестовые данные (TENDER_SOURCE=mock)",
        },
        fingerprint: null,
      };
    }
  }
}
