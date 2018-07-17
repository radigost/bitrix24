const axios = require('axios');
axios.defaults.headers.post['Content-Type'] = 'application/x-www-form-urlencoded';
const querystring = require('qs');

const paramsSerializer = function (params) {
    return querystring.stringify(params, {arrayFormat: 'brackets'})
};

function Bitrix(url) {
    let BitrixUrl = url;
    const bitrix = {
        url,
        crm: {
            product: {
                async list(options) {
                    const {filter, select} = {...options};
                    const res = await axios({
                        method: 'POST',
                        url: `${bitrix.url}/crm.product.list`,
                        data: {filter, select},
                        paramsSerializer,
                    });
                    return res.data.result;

                },
                async update(id, fields) {
                    const res = await  axios({
                        method: 'POST',
                        url: `${bitrix.url}/crm.product.update`,
                        params: {id},
                        data: {fields},
                        paramsSerializer,
                    });
                    return res.data.result;
                },
                async add(fields) {
                    try{
                        const res = await  axios({
                            method: 'POST',
                            url: `${bitrix.url}/crm.product.add`,
                            data: {fields},
                            paramsSerializer,
                        });
                        return res.data.result;
                    }
                    catch (e) {
                        console.error(e.response.data,fields);
                        return;
                        // console.error(e);
                    }

                },
                async fields(){
                    if (!bitrix._productFields){
                        try{
                            const res = await  axios({
                                method: 'GET',
                                url: `${bitrix.url}/crm.product.fields`,
                            });
                            bitrix._productFields = res.data.result;
                            return res.data.result;
                        }
                        catch (e) {
                            console.error(e.response.data);
                            return;
                        }
                    }
                    else return bitrix._productFields;

                },
            }
        }
    };

    return bitrix;
};


const bitrix = new Bitrix('https://olrait.bitrix24.ru/rest/34/a198oeo41csw4cou');


module.exports = bitrix;
