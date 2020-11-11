
const {User} = require('../../db');
const bcrypt = require('bcrypt');
// const crypto = require('crypto');
require('dotenv').config();
const nodemailer = require('nodemailer');
// const { Sequelize } = require('sequelize');
// var fs = require('fs');
const hbs = require('nodemailer-express-handlebars');
// const Op = Sequelize.Op;
const BCRYPT_SALT_ROUNDS = 12;
const {
    EMAIL_ADDRESS, 
    EMAIL_PASSWORD
  } = process.env;



const createUser =  async (ctx)=>{              // crea un usuario y envia el mail de validacion
  var pin = Math.floor(Math.random() * 999999);
    ctx.params.pin = pin
    console.log(ctx.params)
  try{
      const hash = await bcrypt.hash(ctx.params.password, 10);
      ctx.params.password = hash
      const user = await User.create(ctx.params);

      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: EMAIL_ADDRESS,
          pass: EMAIL_PASSWORD,
        },
      });

    const options = {
      viewEngine: {
        partialsDir: __dirname + "/views/partials",
        layoutsDir: './views/layouts', //ESTO ANDA MUY RARO. SOLO ME DEJA BUSCAR SI LA CARPETA VIEWS ESTA EN /API Y BUSCA COMO SI ESTUVIERA PARADO AHI (PONGO ../../ Y SALE DOS PARA ATRAS DE API. PONGO ./ Y LO ENCUENTRA) QCYOOO
        extname: ".hbs"
      },
      extName: ".hbs",
      viewPath: "views"
    };

    transporter.use('compile', hbs(options))
    const pinObject = {}
    pinObject.pin = pin
   
    const mailOptions = {
      from: 'gohenrybank2020@gmail.com',
      to: `${user.email}`,
      subject: 'Gracias por ingresar! Confirme su cuenta',
        template: "crateUserMail",
        context: pinObject

    };

      transporter.sendMail(mailOptions, function(error, info) {
        if (error) {
          console.log(error);
        } else {
          console.log('Email sent: ' + info.response);
        }
      });

      const json = {
               message:"success", 
               content: user
           }
           
      return json
  }
    catch(err) {
        console.log(err)
    }

}


const getMyData = async (ctx) => {  // obtener informacion del usuario segun id
    try {
    const user = await User.findByPk(ctx.params.id)
    const json = {
        message: 'success',
        content: user
    }
    if(user){
    return json;
    } else {
        return "no existe el usuario"
    }
}
    catch(err) {
        return 'noxo'
    }

}


const editData = async (ctx) => {                         // editar num telefono y domicilio de un usuario segun id
    const { phone, province, city, address, addressnum } = ctx.params 
    try {
        const user = await User.update({
            phone,
            province,
            city,
            address,
            addressnum
          }, {
            returning: true,
            where: {
              id: ctx.params.id
            }
          })
          const json = {
              message: 'success',
              content: user
          }
          if(user[0]){
            return json;
            } else {
                return "no existe el usuario"
            }
    }
    catch(err) {
        return 'Los datos ingresados no son permitidos'
    }

}


module.exports = {
    createUser, 
    getMyData, 
    editData
}