# -*- coding: utf-8 -*-

from wtforms.fields.simple import TextField
from flask_wtf import FlaskForm
from flask_wtf.file import FileField, FileAllowed
from wtforms import StringField, PasswordField, SubmitField, IntegerField, SelectField, SelectMultipleField, MultipleFileField
from wtforms.validators import DataRequired, Length, Email, EqualTo, ValidationError, Optional
from wtforms.fields.html5 import DateField, TimeField
from datetime import date
from flask_ckeditor import CKEditorField

class LoginForm(FlaskForm):
    email =  StringField("Mail address(email)", 
                            validators=[DataRequired(), Email()])
    password = PasswordField("Password", 
                            validators=[DataRequired(), Length(min=4, max=20)])

    submit = SubmitField("Signin")

                            
class RegistrationForm(FlaskForm):
    
    email =  StringField("Mail address(email)", 
                            validators=[DataRequired(), Email()])
    username =  StringField("Name", 
                            validators=[DataRequired()])
    phone_number = StringField("Phone Number", 
                            validators=[DataRequired()])
    affiliation = StringField("Affiliation", 
                            validators=[DataRequired()])

    password = PasswordField("Password", 
                            validators=[DataRequired(), Length(min=4, max=20)])
    confirm_password = PasswordField("Password re-type", 
                            validators=[DataRequired(), EqualTo("password")] )
                            
    submit = SubmitField("Register")
