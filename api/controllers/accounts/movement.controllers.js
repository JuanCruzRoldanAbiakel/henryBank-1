require("dotenv").config();
const { MoleculerError } = require("moleculer").Errors;
const { Errors } = require('moleculer-web');
const { use } = require("passport");
const { Sequelize, Model } = require("sequelize");
const {User, Account, Movement} = require('../../db.js')
//paypal
const paypal = require('paypal-rest-sdk');
const { default: Axios } = require("axios");
const { whatsappSend } = require("../whatsapp/whats.config.js");
const {CLIENT_ID, CLIENT_SECRET, TOKEN_PAYPAL } = process.env;
paypal.configure({
    'mode': 'sandbox', //sandbox or live 
    'client_id': CLIENT_ID, // please provide your client id here 
    'client_secret': CLIENT_SECRET // provide your client secret here 
  });

const formatAR = new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS", minimumFractionDigits:2})
//aqui se genera el numero de transaccion para tener una referencia
const numTransaction = async () =>{

    var num = "" + Math.floor(Math.random() * 999999)

    const dato = await Movement.findOne({
        where:{numTransaction:num}
    })

    if(!dato){
        return num;
    }else{
        return numTransaction();
    }
}

const transaction = async (ctx) =>{
    const {phoneUser, phoneContact, amount, description} = ctx.params
    const numMov = await numTransaction();

    try{

        //Se verifica el numero de telefono para traer su cvu de la persona que envia el dinero
        const user = await Account.findOne({include:[{
            model:User,
            where:{phone:phoneUser}
        }]})

        //Se verifica el numero de telefono para traer su cvu de la persona que recibe el dinero
        const contact = await Account.findOne({include:[{
            model:User,
            where:{phone:phoneContact}
        }]})
        
        //Verifica si no supera su monto maximo
        if(user.balance < amount ){
            throw new Error
        }
        if(!user){
            throw new Error
        }
        if(!contact){
            throw new Error
        }
        
        //descuenta y agrega el monto enviado
        await Account.update({balance: Sequelize.literal(`balance - ${amount}`)},{where:{cbu:user.cbu}})
        await Account.update({balance: Sequelize.literal(`balance + ${amount}`)},{where:{cbu:contact.cbu}})
        
        //Crea el movimiento para mantener el registro con el mismo numero de transaccion
        await Movement.create({
            numTransaction: numMov,
            state:"complete",
            amount: amount,
            description:description,
            movement_type:"receiver",
            accountId: contact.id
        })

        await Movement.create({
            numTransaction: numMov,
            state:"complete",
            amount: -amount,
            description:description,
            movement_type:"sender",
            accountId: user.id
        })
        
        let moutARS = formatAR.format(amount)
        await whatsappSend(`+${phoneUser}`,`Acabas de realizar un deposito a *${user.alias}* con un monto de *${moutARS}*`)
        await whatsappSend(`+${phoneContact}`,`Acabas de recibir un deposito de *${user.alias}* con un monto de *${moutARS}*`)

       return{
           message:"success",
           data:{
            numTransaction:numMov,
            type:"sender",
            amount:amount,
            sender:{
                phone:phoneUser,
                alias:user.alias,
                fullName:`${user.user.name} ${user.user.lastname}`,
                dni:user.user.dni
            },
            receiver:{
                phone:phoneContact,
                alias:contact.alias,
                fullName:`${contact.user.name} ${contact.user.lastname}`,
                dni:contact.user.dni
            }
           }
        }

    }catch(err){
        console.log(err)
        throw new MoleculerError("supera el monto maximo", 404, "SERVICE_NOT_FOUND",{err:"err"})
    }
}

const paypalDeposits = async(ctx)=>{
    const {amount, id} = ctx.params
    const {data} = await Axios.get("https://free.currconv.com/api/v7/convert?q=USD_ARS&compact=ultra&apiKey=771ba0bd5ac4f83cd414")
    const usdArs = (data.USD_ARS.toFixed(2) * amount).toFixed(2)
    const payment = {
        "intent":"authorize",
        "payer":{
          "payment_method": "paypal"
        },
        "redirect_urls": {
          "return_url": "http://localhost:3000/api/transactions/paypal/confirm",
          "cancel_url": "http://localhost:3000/api/transactions/paypal/cancel"
        },
        "transactions": [{
            "item_list":{
                "items":[{
                    "name":"Deposito",
                    "sku":"Go Bank",
                    "price":amount,
                    "currency": "USD",
                    "quantity":1
                }]
            },
          "amount": {
            "total": amount,
            "currency": "USD"
          }
        }]
    }

    try{
        const data = await createPay(payment)
        if(!data){
            throw new Error
        }

        await Movement.create({
            numTransaction: data.id ,
            state:"created",
            amount:usdArs,
            description:"Deposito Paypal",
            movement_type:"deposits",
            accountId: id
        })

        return{
            message:"success",
            numTransaction:data.id,
            link: data.links[1].href
        }

    }catch(err){
        console.log(err)
    }
}

const createPay = ( payment ) => {
    return new Promise( ( resolve , reject ) => {
        paypal.payment.create( payment , function( err , payment ) {
         if ( err ) {
             reject(err); 
         }
        else {
            resolve(payment); 
        }
        }); 
    });
  }

const confirmPaypal = async (ctx) =>{
    const {paymentId} = ctx.params
    let amount;
    try{
        const {data} = await Axios.get(`https://api.sandbox.paypal.com/v1/payments/payment/${paymentId}`,{
            headers:{
                'Content-Type': 'application/json',
                'Authorization': 'Bearer A21AAJhDVWmm7cK_4cHVA3Yb6YtuuX5vs91m5Ebg7Erp090b0Pz5XuzzRmckB7h0Ki6Y8cCEaxvEbKj6EK1KSjKMpKJFre7oA'
            }
        })
        
        console.log(data)
        if(!data || !data.payer.status){
            throw new Error;
        }

        if(data.payer.status === "VERIFIED"){
           const amount = await Movement.findOne({where:{numTransaction:paymentId}})
           const {phone, accounts} = await User.findOne({include:[{
            model:Account,
            where:{userId:amount.accountId}
            }]})
            if(amount.state !== "complete"){
                await Movement.update({state:"complete"},{where:{numTransaction:paymentId}})
                await Account.update({balance: Sequelize.literal(`balance + ${amount.amount}`)},{where:{id:amount.accountId}})
                let moutARS = formatAR.format(amount.amount)
                await whatsappSend(`+${phone}`,`*${accounts[0].alias}* Acabas de recibir una recarga desde *Paypal* con un monto de *${moutARS}*`)
                return {
                    message:"success",
                    content:{
                        state:'Deposit success',
                        complete:true
                    }
                }
            }
        }

        throw new MoleculerError("Complete su deposito", 404, "SERVICE_NOT_FOUND")
    }catch(err){
        throw new MoleculerError("deposito no existe", 404, "SERVICE_NOT_FOUND")
    }
}


module.exports={
    transaction,
    paypalDeposits,
    confirmPaypal
}