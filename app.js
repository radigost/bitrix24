// var createError = require('http-errors');
// var express = require('express');
// var path = require('path');
// var cookieParser = require('cookie-parser');
// var logger = require('morgan');
const axios = require('axios');
const CONFIG = require('./config');
const crypto = require("crypto");
const _ = require('lodash');
var http = require('http');
var fs = require('fs');
const bitrix = require('./bitrix');

const processPrice = async () => {
    console.time('total')
    const download = (url, dest) => {
        return new Promise((resolve, reject) => {
            console.time('download file');
            var file = fs.createWriteStream(dest);
            var request = http.get(url, function (response) {
                response.pipe(file);
                file.on('finish', function () {
                    console.timeEnd('download file');
                    file.close(resolve);  // close() is async, call cb after close completes.
                });
            }).on('error', function (err) { // Handle errors
                fs.unlink(dest); // Delete the file async. (But we don't check the result)
                reject(err);
            });
        })
    };
    const readCsv = async (path) => {
        console.time('read csv');
        var csv = require("fast-csv");
        return new Promise((resolve) => {
            const csvData = [];
            csv
                .fromPath(path, {
                    delimiter: ';',
                    headers: true
                })
                .on("data", function (data) {
                    csvData.push(data);
                })
                .on("end", async function () {
                    console.timeEnd('read csv');
                    resolve(csvData);
                });
        })
    };

    const generateFields = async (element) => {
        const date = new Date();
        const idValue = 'PROPERTY_500';
        const NOMENCLATURE_TYPE_ID = 334;
        const generate = require('nanoid/generate');
        const dictionary = require('nanoid-dictionary');
        const letters = generate(dictionary.alphabets.english.uppercase, 3);
        const digits = generate(dictionary.numbers, 6);
        const fields = {
            'NAME': element.new.name,
            'PRICE': element.new.price,
            'VAT_INCLUDED': element.new.VAT_INCLUDED,
            'DESCRIPTION': element.new.description,
            'PROPERTY_198': element.new.article, //article
            'PROPERTY_494': element.new.url,//ссылка на обисание
            'PROPERTY_496': date.toISOString(), //дата обновления
            'PROPERTY_498': `${letters}-${digits}`, //артикул для клиентов
            'PROPERTY_512': NOMENCLATURE_TYPE_ID, //вид номенклатуры
            // 'PROPERTY_212': element.new.brand,//бренд
            'PROPERTY_500': _.get(element, 'old.PROPERTY_500.value', _.get(element, 'new.id')), //id с сайта
            'ACTIVE': element.new.active,
        };
        // fields[idValue] = element.new.id;
        const querystring = require('qs');
        let image, detailedImage;
        const imageExtension = _.last(_.split(element.new.picture_preview_link, '.'));
        const detailedImageExtension = _.last(_.split(element.new.picture_detail_link, '.'));

        try {
            image = await
                axios.get(element.new.picture_preview_link, {responseType: 'arraybuffer'});
            detailedImage = await
                axios.get(element.new.picture_detail_link, {responseType: 'arraybuffer'});
        }
        catch (e) {
            // console.warn(e);
        }
        finally {
            if (image) {
                fields.PREVIEW_PICTURE = {"fileData": [`picture.${imageExtension}`, new Buffer(image.data, 'binary').toString('base64')]}
            }
            if (detailedImage) {
                fields.DETAIL_PICTURE = {"fileData": [`picture.${detailedImageExtension}`, new Buffer(detailedImage.data, 'binary').toString('base64')]}
            }
            return fields;
        }

    };
    const update = async (element) => {
        if (element && element.old && element.new) {
            const id = element.old.ID;
            const fields = await generateFields(element);
            await bitrix.crm.product.update(id, fields);
        }
        else {
            console.warn('something wrong - ', {element});
            return Promise.resolve({data: {result: 'problem in program'}});
        }
    };
    const addNew = async (element) => {
        if (element && element.new) {
            try {
                const fields = await generateFields(element);

                await bitrix.crm.product.add(fields);
            }
            catch (e) {
                console.error(e);
            }
        }
        else {
            console.warn('something wrong - ', {element});
            return Promise.resolve({data: {result: 'problem in program'}});
        }
    };
    const sortArrays = async (csvData) => {
        console.time('sort arrays');
        return new Promise(async (resolve, reject) => {
            let productBrandValues = await bitrix.crm.product.fields();
            productBrandValues = productBrandValues['PROPERTY_212'];

            const toUpdate = [];
            const toAdd = [];
            let i = 0;
            // const length = 10;
            const length = csvData.length - 1;
            const hasPropertiesToUpdate = (element) => {
                let res = false;
                const propertiesToCheck = [
                    'NAME',
                    'PRICE',
                    'VAT_INCLUDED',
                    'ACTIVE',
                    // 'PROPERTY_212'
                ];
                const propertiesMap = {
                    'NAME': 'name',
                    'PRICE': 'price',
                    'VAT_INCLUDED': 'VAT_INCLUDED',
                    'ACTIVE': 'active',
                    'PROPERTY_212': 'brand'
                };
                res = propertiesToCheck.reduce((updateDecision, property) => {
                    if (!updateDecision) {
                        const newProp = _.get(propertiesMap, [property]);
                        const newEl = _.get(element, ['new', newProp]);
                        const oldEl = _.get(element, ['old', property]);
                        if (oldEl !== newEl) {
                            updateDecision = true;
                        }
                    }
                    return updateDecision;
                }, false);
                return res;
            };
            const processRow = async (i, length) => {
                const percent = i / csvData.length * 100;
                process.stdout.write("\r" + `reading ${i} of ${csvData.length} : ${Math.floor(percent)}%`);
                if (i <= length) {
                    setTimeout(async ()=>{
                        try {
                            const res = await bitrix.crm.product.list({
                                filter: {'PROPERTY_500': {value: csvData[i]['id']}},
                                select: ['ID', 'PROPERTY_500', 'NAME', 'PRICE', 'VAT_INCLUDED', 'PROPERTY_198', 'PROPERTY_496', 'ACTIVE',
                                    'PROPERTY_212'
                                ]
                            });
                            const result = _.head(res);
                            const updateElement = {new: csvData[i], old: result};
                            if (result) {
                                if (hasPropertiesToUpdate(updateElement)) {
                                    await update(updateElement);
                                }
                            }
                            else {
                                addNew({new: csvData[i]});
                                // toAdd.push({new: csvData[i]});
                            }

                        } catch (err) {
                            if (err.response.status === 503) {
                                console.error('too many request, closing app with result', {
                                    exist: toUpdate.length,
                                    nonExist: toAdd.length
                                });
                                console.error('try to change "timeout" in config.json, current timeout:', CONFIG.timeout / 6000, " мин");
                                clearInterval(timer);
                                reject();
                            }
                            else {
                                console.error(err);
                            }
                        }
                        finally {
                            i++;
                            await processRow(i, length);
                        }
                    },CONFIG.timeout);

                }
                else {
                    resolve();
                }
            };

            await processRow(i, length);
        });
    };

    const csvPath = 'export.csv';
    await download('http://olrait.ru/upload/export_1670813724.csv', csvPath, (res) => console.log(res));
    const csvData = await readCsv(csvPath);
    await sortArrays(csvData);


    // console.log(res.data.result);
//    ID , NAME, SECTION_ID , CATALOG_ID
//получить список section crm.productsection.list
// по каждому новому товару - проверять поле - есть в списке section - если нет - то создавать новое, получать его Id и добавлять в поле товара

//    по старому товару - проверять все поля и менять разные
//    добавлять дату обновления в каждый товар


};


const deletePack = async (result, next, start, notDeletedLength) => {
    const notDeleted = [];
    return new Promise((resolve) => {
        const length = result.length;
        let i = notDeletedLength;
        const ress = (notDeletedLength) => {
            // const PER_PAGE = 50;
            if (notDeletedLength >= length) {
                start = next;
                notDeletedLength = 0;
            }
            else {
                notDeletedLength = notDeleted.length + notDeletedLength;
            }
            resolve({start, notDeletedLength});
        };


        let timer = setInterval(async () => {

            if (i < length && result[i]['ID']) {
                try {
                    const element = result[i++];
                    if (element) {
                        console.log({i, length}, element['ID']);
                        const r = await axios.get('https://olrait.bitrix24.ru/rest/34/a198oeo41csw4cou/crm.deal.delete', {params: {id: element.ID}});
                        console.log(r.data.result);
                    }
                }
                catch (e) {
                    notDeleted.push(result[i]);
                    console.log(`not deleted - ${i}`)
                }
                finally {

                }
            }
            else {
                ress(notDeletedLength);
                clearInterval(timer);
            }
        }, CONFIG.timeout, notDeletedLength);
    });

};
const deleteAll = async (start = 1, notDeletedLength = 0) => {
    if (start) {
        const res = await axios.get('https://olrait.bitrix24.ru/rest/34/a198oeo41csw4cou/crm.deal.list?FILTER[<DATE_CREATE]=2018-07-03', {params: {start}});
        console.log(res.data.next, res.data.total);
        // start = res.data.next;

        const r = await deletePack(res.data.result, res.data.next, start, notDeletedLength);
        start = r.start;
        notDeletedLength = r.notDeletedLength;

        if (res.data.next) {
            await deleteAll(start, notDeletedLength);
        }
        console.log('deleted all');
    }
    else {
        console.log('delete all')
        // console.log('and left not deleted', notDeleted.length)
    }
}
console.time('delete all');


processPrice();
// deleteAll();
//
// var indexRouter = require('./routes/index');
// // var usersRouter = require('./routes/users');
//
// var app = express();
//
// // view engine setup
// app.set('views', path.join(__dirname, 'views'));
// app.set('view engine', 'pug');
//
// app.use(logger('dev'));
// app.use(express.json());
// app.use(express.urlencoded({extended: false}));
// app.use(cookieParser());
// // app.use(express.static(path.join(__dirname, 'public')));
//
// app.use('/', indexRouter);
// // app.use('/users', usersRouter);
//
// // catch 404 and forward to error handler
// app.use(function (req, res, next) {
//     next(createError(404));
// });
//
// // error handler
// app.use(function (err, req, res, next) {
//     // set locals, only providing error in development
//     res.locals.message = err.message;
//     res.locals.error = req.app.get('env') === 'development' ? err : {};
//
//     // render the error page
//     res.status(err.status || 500);
//     res.render('error');
// });
//
// module.exports = app;
