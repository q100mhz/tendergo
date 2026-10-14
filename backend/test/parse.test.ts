import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { innFromIkz, parseEisDate, parseEisPrice, parseNoticePage, parseSearchPage } from "../src/ingest/eis/parse.js";
import { mskOffset, regionFromText } from "../src/lib/regions.js";

// Real zakupki.gov.ru pages (via web.archive.org) with scripts and contact details stripped.
const fixture = (name: string) => readFileSync(new URL(`./fixtures/eis/${name}`, import.meta.url), "utf8");

describe("parseEisDate", () => {
  it("treats times as Moscow time", () => {
    expect(parseEisDate("21.10.2026 10:00")?.toISOString()).toBe("2026-10-21T07:00:00.000Z");
    expect(parseEisDate("21.10.2026 10:00 (МСК)")?.toISOString()).toBe("2026-10-21T07:00:00.000Z");
  });
  it("applies MSK offsets", () => {
    expect(parseEisDate("21.10.2026 10:00 (МСК+4)")?.toISOString()).toBe("2026-10-21T03:00:00.000Z");
    expect(parseEisDate("21.10.2026 10:00 (МСК−1)")?.toISOString()).toBe("2026-10-21T08:00:00.000Z");
  });
  it("uses the default offset only without an explicit marker", () => {
    expect(parseEisDate("21.10.2026 10:00", 7)?.toISOString()).toBe("2026-10-21T00:00:00.000Z");
    expect(parseEisDate("21.10.2026 10:00 (МСК)", 7)?.toISOString()).toBe("2026-10-21T07:00:00.000Z");
  });
  it("handles date-only and garbage", () => {
    expect(parseEisDate("21.10.2026")?.toISOString()).toBe("2026-10-20T21:00:00.000Z");
    expect(parseEisDate("—")).toBeNull();
  });
});

describe("parseEisPrice", () => {
  it("parses spaced rubles", () => {
    expect(parseEisPrice("1 234 567,89 ₽")).toBe("1234567.89");
    expect(parseEisPrice("500 000,00 ₽")).toBe("500000.00");
    expect(parseEisPrice("")).toBeNull();
  });
});

describe("regions", () => {
  it.each([
    ["Татарстан Респ", "16"],
    ["603001, обл. Нижегородская, г. Нижний Новгород", "52"],
    ["Алтайский край", "22"],
    ["Алтай Респ", "04"],
    ["420115, Респ Татарстан, г Казань, ул Московская", "16"],
    ["г. Москва, ул. Тверская", "77"],
    ["Московская обл, г Химки", "50"],
    ["Ханты-Мансийский Автономный округ - Югра АО", "86"],
    ["Ямало-Ненецкий АО", "89"],
    ["Ненецкий АО", "83"],
    ["Саха /Якутия/ Респ", "14"],
    ["Северная Осетия - Алания Респ", "15"],
    ["Марий Эл Респ", "12"],
  ])("%s → %s", (text, code) => expect(regionFromText(text)).toBe(code));

  it("returns null for unknown places", () => expect(regionFromText("Нью-Йорк")).toBeNull());
  it("knows time zones", () => {
    expect(mskOffset("27")).toBe(7);
    expect(mskOffset("77")).toBe(0);
    expect(mskOffset(null)).toBe(0);
  });
});

describe("innFromIkz", () => {
  it("extracts the customer INN", () => {
    expect(innFromIkz("262165540556016550100100150017220244")).toBe("1655405560");
    expect(innFromIkz("123")).toBeNull();
  });
});

describe("search results page", () => {
  const cards = parseSearchPage(fixture("search-results.html"), "https://zakupki.gov.ru");

  it("extracts every card", () => {
    expect(cards).toHaveLength(10);
    expect(cards.filter((c) => c.law === "223")).toHaveLength(2);
  });

  it("extracts card fields", () => {
    expect(cards[0]).toMatchObject({
      regNumber: "0348300169726000011",
      law: "44",
      procedureType: "Электронный аукцион",
      stage: "Подача заявок",
      title: "Оказание услуг по организации специальных VPN каналов связи для оборудования сопряжения с РАСЦО",
      maxPrice: "29405059.68",
      url: "https://zakupki.gov.ru/epz/order/notice/ea20/view/common-info.html?regNumber=0348300169726000011",
    });
    expect(cards[0]!.customerName).toContain("ШКОЛА № 2070");
    expect(cards[0]!.submissionDeadline?.toISOString()).toBe("2026-04-26T21:00:00.000Z");
    expect(cards[0]!.sourceUpdatedAt?.toISOString()).toBe("2026-04-16T21:00:00.000Z");
  });

  it("skips links with unexpected protocols", () => {
    const html = fixture("search-results.html").replace(
      'href="/epz/order/notice/ea20/view/common-info.html?regNumber=0348300169726000011"',
      'href="javascript:alert(1)"',
    );
    expect(parseSearchPage(html, "https://zakupki.gov.ru").map((c) => c.regNumber)).not.toContain("0348300169726000011");
  });
});

describe("44-ФЗ notice", () => {
  it("parses a notice placed by the customer", () => {
    const d = parseNoticePage(fixture("notice44.html"));
    expect(d).toMatchObject({
      maxPrice: "5793333.26",
      customerName: "КОМИТЕТ РЕСПУБЛИКИ ТАТАРСТАН ПО ОХРАНЕ ОБЪЕКТОВ КУЛЬТУРНОГО НАСЛЕДИЯ",
      customerInn: "1655405560",
      regionCode: "16",
      okpd2Codes: ["72.20.29.110"],
      ktruCodes: [],
    });
    expect(d.submissionDeadline?.toISOString()).toBe("2026-05-12T04:00:00.000Z");
  });

  it("takes the real customer when an authorized body places the order", () => {
    const d = parseNoticePage(fixture("notice44-authorized-body.html"));
    expect(d).toMatchObject({
      customerName: "МИНИСТЕРСТВО ЗДРАВООХРАНЕНИЯ РЕСПУБЛИКИ МАРИЙ ЭЛ",
      customerInn: "1200000881",
      regionCode: "12",
      okpd2Codes: ["21.20.10.132"],
    });
    expect(d.submissionDeadline?.toISOString()).toBe("2024-09-18T05:00:00.000Z");
  });
});

describe("223-ФЗ notice", () => {
  it("parses the common info tab", () => {
    const d = parseNoticePage(fixture("notice223.html"));
    expect(d).toMatchObject({
      customerName: 'ПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО "РОССЕТИ ЦЕНТР И ПРИВОЛЖЬЕ"',
      customerInn: "5260200603",
      regionCode: "52",
    });
    expect(d.submissionDeadline?.toISOString()).toBe("2022-06-01T09:00:00.000Z");
  });

  it("takes ОКПД2 but not ОКВЭД2 codes from the lots tab", () => {
    expect(parseNoticePage(fixture("notice223-lots.html")).okpd2Codes).toEqual(["26.30.40.110"]);
  });

  it("converts the customer's local deadline to Moscow time", () => {
    const d = parseNoticePage(`<body>
      <span class="section__title">Почтовый адрес</span><span class="section__info">680000, Хабаровский край, г. Хабаровск</span>
      <span class="section__title">Дата и время окончания срока подачи заявок (по местному времени заказчика)</span>
      <span class="section__info">01.06.2026 12:00</span></body>`);
    expect(d.regionCode).toBe("27");
    expect(d.submissionDeadline?.toISOString()).toBe("2026-06-01T02:00:00.000Z");
  });
});

describe("code extraction", () => {
  it("reads short ОКПД2 codes from classification columns only", () => {
    const d = parseNoticePage(`<table>
      <thead><tr><th>Лот</th><th>Классификация по ОКПД2</th><th>Классификация по ОКВЭД2</th></tr></thead>
      <tbody><tr><td>1 Ремонт</td><td>41.20.40 Работы строительные</td><td>41.20 Строительство зданий</td></tr></tbody>
    </table>`);
    expect(d.okpd2Codes).toEqual(["41.20.40"]);
  });

  it("handles the extra toggle cell and КТРУ codes in position tables", () => {
    const d = parseNoticePage(`<table>
      <thead><tr><th>Код позиции</th><th>Наименование товара</th></tr></thead>
      <tbody>
        <tr><td></td><td>26.20.15.000-00000027</td><td>Компьютер</td></tr>
        <tr><td></td><td>21.20.10.132-000016-1-00242</td><td>Лекарство</td></tr>
      </tbody>
    </table>`);
    expect(d.ktruCodes).toEqual(["21.20.10.132-000016-1-00242", "26.20.15.000-00000027"]);
    expect(d.okpd2Codes).toEqual(["21.20.10.132", "26.20.15.000"]);
  });

  it("ignores dates and prices", () => {
    const d = parseNoticePage("<body>Срок 14.10.2026, цена 1 234,56, версия 10.0.1</body>");
    expect(d.okpd2Codes).toEqual([]);
    expect(d.ktruCodes).toEqual([]);
  });
});
