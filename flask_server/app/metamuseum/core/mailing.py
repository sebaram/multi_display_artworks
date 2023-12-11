import smtplib

# Import the email modules we'll need
from email.message import EmailMessage
from flask import flash, current_app
from metamuseum.models import User

def send_this_to_admin(title, txt):
    msg = EmailMessage()
    msg.set_content(txt)

    admins = User.query.filter(User.user_type.contains('admin'))
    mails = [one.email for one in admins]

    msg['Subject'] = f'[CT-AR]{title}'
    msg['From'] = "noreply@uvrlab.org"
    msg['To'] = ", ".join(mails)

    # Send the message via our own SMTP server.
    server = smtplib.SMTP_SSL(current_app.config['SMTP_SERVER'], 465)
    server.login(current_app.config['SMTP_ID'], current_app.config['SMTP_PW'])    
    server.send_message(msg)
    server.quit()
    
