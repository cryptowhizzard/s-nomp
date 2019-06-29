var request = require('request');
var nonce   = require('nonce');

module.exports = function() {
    'use strict';

    // Module dependencies

    // Constants
    var version         = '0.1.0',
        PUBLIC_API_URL  = 'https://app.stex.com/api2',
        PRIVATE_API_URL = 'https://app.stex.com/api2',
        USER_AGENT      = 'nomp/node-open-mining-portal'

    // Constructor
    function Stex(key, secret){
        // Generate headers signed by this user's key and secret.
        // The secret is encapsulated and never exposed
        this._getPrivateHeaders = function(parameters){
            var paramString, signature;

            if (!key || !secret){
                throw 'Stex: Error. API key and secret required';
            }

            // Sort parameters alphabetically and convert to `arg1=foo&arg2=bar`
            paramString = Object.keys(parameters).sort().map(function(param){
                return encodeURIComponent(param) + '=' + encodeURIComponent(parameters[param]);
            }).join('&');

            signature = crypto.createHmac('sha512', secret).update(paramString).digest('hex');

            return {
                Key: key,
                Sign: signature
            };
        };
    }

    // If a site uses non-trusted SSL certificates, set this value to false
    Stex.STRICT_SSL = true;

    // Helper methods
    function joinCurrencies(currencyA, currencyB){
        return currencyA + '-' + currencyB;
    }

    // Prototype
    Stex.prototype = {
        constructor: Stex,

        // Make an API request
        _request: function(options, callback){
            if (!('headers' in options)){
                options.headers = {};
            }

            options.headers['User-Agent'] = USER_AGENT;
            options.json = true;
            options.strictSSL = Stex.STRICT_SSL;

            request(options, function(err, response, body) {
		//console.log('STEX Api Request initiated' + JSON.stringify(body));
                callback(err, body);
            });

            return this;
        },

        // Make a public API request
        _public: function(parameters, callback){
            var options = {
                method: 'GET',
                url: PUBLIC_API_URL,
                qs: parameters
            };

            return this._request(options, callback);
        },

        // Make a private API request
        _private: function(parameters, callback){
            var options;

            parameters.nonce = nonce();
            options = {
                method: 'POST',
                url: PRIVATE_API_URL,
                form: parameters,
                headers: this._getPrivateHeaders(parameters)
            };

            return this._request(options, callback);
        },


        /////


        // PUBLIC METHODS

        getTicker: function(callback){
            var options = {
                method: 'GET',
                url: PUBLIC_API_URL + '/ticker',
                //qs: null
            };

            return this._request(options, callback);
        },

        getOrderBook: function(currencyA, currencyB, callback){
             var options = {
                 method: 'GET',
                 url: PUBLIC_API_URL + '/orderbook?pair=' + currencyB.toUpperCase() + '_' + currencyA.toUpperCase() + '&count=1',
                 //qs: null
             };

	     console.log('STEX Api Orderbook initiated' + JSON.stringify(options));
             return this._request(options, callback);
        },

        //getOrderBook: function(currencyA, currencyB, callback){
        //    var parameters = {
        //        instrument: joinCurrencies(currencyA, currencyB),
        //        //type: 'buy',
        //        limit: '50'
        //    }
        //    var options = {
        //        method: 'GET',
        //        url: PUBLIC_API_URL + '/orderBook',
        //        qs: parameters
        //    }
	//
        //    return this._request(options, callback);
        //},

        getTradeHistory: function(currencyA, currencyB, callback){
            var parameters = {
                    command: 'getTradeHistoryPublic',
                    currencyPair: joinCurrencies(currencyA, currencyB)
                };

            return this._public(parameters, callback);
        },


        /////


        // PRIVATE METHODS

        myBalances: function(callback){
            var parameters = {
                    command: 'returnBalances'
                };

            return this._private(parameters, callback);
        },

        myOpenOrders: function(currencyA, currencyB, callback){
            var parameters = {
                    command: 'returnOpenOrders',
                    currencyPair: joinCurrencies(currencyA, currencyB)
                };

            return this._private(parameters, callback);
        },

        myTradeHistory: function(currencyA, currencyB, callback){
            var parameters = {
                    command: 'returnTradeHistory',
                    currencyPair: joinCurrencies(currencyA, currencyB)
                };

            return this._private(parameters, callback);
        },

        buy: function(currencyA, currencyB, rate, amount, callback){
            var parameters = {
                    command: 'buy',
                    currencyPair: joinCurrencies(currencyA, currencyB),
                    rate: rate,
                    amount: amount
                };

            return this._private(parameters, callback);
        },

        sell: function(currencyA, currencyB, rate, amount, callback){
            var parameters = {
                    command: 'sell',
                    currencyPair: joinCurrencies(currencyA, currencyB),
                    rate: rate,
                    amount: amount
                };

            return this._private(parameters, callback);
        },

        cancelOrder: function(currencyA, currencyB, orderNumber, callback){
            var parameters = {
                    command: 'cancelOrder',
                    currencyPair: joinCurrencies(currencyA, currencyB),
                    orderNumber: orderNumber
                };

            return this._private(parameters, callback);
        },

        withdraw: function(currency, amount, address, callback){
            var parameters = {
                    command: 'withdraw',
                    currency: currency,
                    amount: amount,
                    address: address
                };

            return this._private(parameters, callback);
        }
    };

    return Stex;
}();
