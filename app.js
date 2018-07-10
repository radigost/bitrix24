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
    const sortArrays = async (csvData) => {
        console.time('sort arrays');
        return new Promise((resolve, reject) => {

            const idValue = 'PROPERTY_500'
            const toUpdate = [];
            const toAdd = [];
            let i = 0;
            const length = csvData.length-1;
            let timer = setInterval(async () => {
                const percent = i / csvData.length * 100;
                // console.log(`reading ${i} of ${csvData.length} : ${Math.floor(percent)}}%`);
                process.stdout.write("\r" + `reading ${i} of ${csvData.length} : ${Math.floor(percent)}%`);

                if (i <= length) {
                    try {
                        const res = await axios.get(`https://olrait.bitrix24.ru/rest/34/a198oeo41csw4cou/crm.product.list?filter[${idValue}][value]=${csvData[i]['id']}`);
                        const result = _.head(res.data.result);
                        if(result){
                            toUpdate.push({new: csvData[i], old: result});
                        }
                        else{
                            toAdd.push({new: csvData[i]});
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
                    }

                }
                else {
                    console.log({
                        exist: toUpdate.length,
                        nonExist: toAdd.length
                    });
                    console.timeEnd('sort arrays');
                    clearInterval(timer);
                    resolve([toAdd, toUpdate]);
                }
            }, CONFIG.timeout);
        })
    }


    const csvPath = 'export.csv';
    // const length = 10;//dev limit of rows
    await download('http://olrait.ru/upload/export_1670813724.csv', csvPath, (res) => console.log(res));
    const csvData = await readCsv(csvPath);
    let [toAdd, toUpdate] = await sortArrays(csvData);

    const update = async (element) => {
        if(element && element.old && element.new){
            const id =  element.old.ID;
            const PRODUCT_VALUE_ID= 334;
            const date = new Date();

            const updateElement = {
                'NAME': element.new.name,
                'PRICE': element.new.price,
                'VAT_INCLUDED': element.new.VAT_INCLUDED,
                'PREVIEW_PICTURE': element.new.picture_preview_link,
                'DETAIL_PICTURE': element.new.picture_detail_link,
                'DESCRIPTION': element.new.description,
                'PROPERTY_198': element.new.article, //article
                'PROPERTY_494': element.new.url,//ссылка на обисание
                'PROPERTY_496': date.toISOString(), //дата обновления
                'PROPERTY_498': element.old['PROPERTY_498']?element.old['PROPERTY_498']:crypto.randomBytes(3 * 4).toString('base64'), //артикул для клиентов
                'PROPERTY_512':PRODUCT_VALUE_ID //вид номенклатуры
            }


            let url = `https://olrait.bitrix24.ru/rest/34/a198oeo41csw4cou/crm.product.update?id=${id}`;
            _.forEach(updateElement,(param,paramName)=>{
                url += `&fields[${encodeURI(paramName)}]=${encodeURI(param)}`
            });
            // console.log(url);
            return axios.post(url);
        }
        else{
            console.warn('something wrong - ',{element})
            return Promise.resolve({data:{result:'problem in program'}});
        }

    }


    // console.log(toUpdate[0]);
    try{
        console.time('update')
        let i = toUpdate.length-1;
        let int = setInterval(async ()=>{
            if(i>=0){
                const res = await update(toUpdate[i--]);
                process.stdout.write("\r" + `udate ${i} of ${toUpdate.length} : ${Math.floor(100-100*i/toUpdate.length)}%`);
                // console.log(i+1,'--',res.data.result);
            }
            else{
                console.log('ended');
                console.timeEnd('update');
                console.timeEnd('total');
                clearInterval(int);
            }
        },CONFIG.timeout,i)

    }
    catch (e) {
        console.error(e);
    }



    // const res = await axios.get('https://olrait.bitrix24.ru/rest/34/a198oeo41csw4cou/crm.productsection.list');

    //article generations
    // console.log(crypto.randomBytes(3 * 4).toString('base64'));
    // var shortid = require('shortid');
    // console.log(shortid.generate());


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
