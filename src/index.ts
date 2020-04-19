import {OAuth2Client} from 'google-auth-library';
import {google, sheets_v4} from 'googleapis';
import fs from 'fs';
import {zipObject, camelCase} from 'lodash';

// const SHEET_ID = '1lhr9srU-NWesmIklMBNSoGJt0Fx-GBfvb7zJzfoiJ1M';
const SHEET_ID = '1deO9EM5GOVSzUbOt4N25WQxAKqce9FAuRU4tyGuV5p4';

const ITEM_SHEETS = [
  'Housewares',
  'Miscellaneous',
  'Wall-mounted',
  'Wallpapers',
  'Floors',
  'Rugs',
  'Fencing',
  'Photos',
  'Posters',
  'Tools',
  'Tops',
  'Bottoms',
  'Dresses',
  'Headwear',
  'Accessories',
  'Socks',
  'Shoes',
  'Bags',
  'Umbrellas',
  'Music',
  'Fossils',
  'Other',
];

const CREATURE_SHEETS = [
  'Bugs - North',
  'Bugs - South',
  'Fish - North',
  'Fish - South',
];

const NOOK_MILE_SHEETS = ['Nook Miles'];

const RECIPE_SHEETS = ['Recipes'];

const IGNORED_SHEETS = ['Construction', 'Achievements', 'Villagers'];

type ItemData = any[];

export async function main(auth: OAuth2Client) {
  const sheets = google.sheets({version: 'v4', auth});

  if (!fs.existsSync('cache')) {
    fs.mkdirSync('cache');
  }

  if (!fs.existsSync('out')) {
    fs.mkdirSync('out');
  }

  const workSet: Array<[string, string[]]> = [
    ['items', ITEM_SHEETS],
    ['creatures', CREATURE_SHEETS],
    ['nookMiles', NOOK_MILE_SHEETS],
    ['recipes', RECIPE_SHEETS],
  ];

  for (const [key, sheetNames] of workSet) {
    console.log(`Loading ${key}`);

    let data = await loadData(sheets, sheetNames, key);

    console.log(`Writing raw file to disk`);
    fs.writeFileSync(
        `out/${key}-raw.json`,
        JSON.stringify(data, undefined, ' '),
    );

    console.log(`Normalising data`);
    data = await normalizeData(data);

    console.log(`Writing data to disk`);
    fs.writeFileSync(`out/${key}.json`, JSON.stringify(data, undefined, ' '));

    console.log(`Finished ${key}`);
  }
}

export async function loadData(
    sheets: sheets_v4.Sheets,
    sheetNames: string[],
    key: string,
) {
  const cacheFile = `cache/${key}.json`;

  try {
    const file = fs.readFileSync(cacheFile);

    return JSON.parse(file.toString());
  } catch (e) {} // ignored

  let data: ItemData = [];

  for (const sheetName of sheetNames) {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: sheetName,
      valueRenderOption: 'FORMULA',
    });

    const [header, ...rows] = response.data.values!;

    for (const row of rows) {
      if (key === 'creatures') {
        console.log(row);
        process.exit(0);
      }

      data.push({SourceSheet: sheetName, ...zipObject(header, row)});
    }
  }

  fs.writeFileSync(cacheFile, JSON.stringify(data, undefined, '  '));

  return data;
}

interface ValueFormatters {
  [key: string]: (input: string, item: any) => any;
}

const valueFormatters: ValueFormatters = {
  image: extractImageUrl,
  house: extractImageUrl,
  uses: normaliseUse,
  source: (input: string) => input.split('\n'),
};

const NULL_VALUES = new Set(['None', 'NA', 'Does not play music']);

export async function normalizeData(data: ItemData) {
  for (const item of data) {
    // Normalise keys first
    for (const objectKey of Object.keys(item)) {
      let value = item[objectKey];
      delete item[objectKey];

      let key = camelCase(objectKey);

      // Need to convert # to num because camelCase converts it to an empty string
      if (objectKey === '#') {
        key = 'num';
      }

      item[key] = value;
    }

    // Normalise data second
    for (const key of Object.keys(item)) {
      let value = item[key];
      const valueFormatter = valueFormatters[key];

      if (typeof value === 'string') {
        value = value.trim();
      }

      if (valueFormatter) {
        value = valueFormatter(value, item);
      }

      if (
          NULL_VALUES.has(value) ||
          (typeof value === 'string' && value === '')
      ) {
        value = null;
      }

      if (value === 'Yes') {
        value = true;
      }
      if (value === 'No') {
        value = false;
      }

      if (value === 'NFS') {
        value = -1;
      }

      item[key] = value;
    }
  }

  return data;
}

function extractImageUrl(input: string) {
  return input.slice(8, -2);
}

function normaliseUse(input: string | number) {
  if (typeof input === 'number') {
    return input;
  }

  if (input === 'Unlimited') {
    return -1;
  }

  // The flimsy fishing rod is the only tool that has variable use
  //  amounts, for some reason. For the purposes of ensuring our
  //  types are correct we'll force it to 9.5 :)
  if (input === '9.5?') {
    return 9.5;
  }

  throw new Error(`Unexpected Use value: ${input}`);
}