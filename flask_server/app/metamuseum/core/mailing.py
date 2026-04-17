from flask import current_app
from flask_mail import Mail, Message
from metamuseum.models import User
import smtplib
import logging

logger = logging.getLogger(__name__)
mail = Mail()

def send_this_to_admin(title, txt):
    try:
        admins = User.objects(user_type__contains='admin')
        mails = [one.email for one in admins]
        if not mails:
            logger.warning("No admins found to send email")
            return

        msg = Message(
            subject=f'[CT-AR]{title}',
            recipients=mails,
            body=txt,
            sender=current_app.config.get('MAIL_DEFAULT_SENDER', 'noreply@uvrlab.org')
        )
        mail.send(msg)
    except Exception as e:
        logger.error(f"Failed to send admin email: {e}")