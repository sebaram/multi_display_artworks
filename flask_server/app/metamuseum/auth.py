from flask import Blueprint
from flask import current_app, render_template, request, url_for, redirect, flash, abort, session
from flask_login import login_user, logout_user, login_required, current_user
from flask_bcrypt import generate_password_hash, check_password_hash
from flask_mail import Mail, Message

from urllib.parse import urlparse, urljoin, quote

from itsdangerous import URLSafeTimedSerializer, SignatureExpired, BadSignature

from metamuseum import login_manager, db, mail
from metamuseum.models import User
from metamuseum.forms import LoginForm, RegistrationForm

bp = Blueprint('auth', __name__, url_prefix='/')

def clear_session():
    if "experiment_id" in session:
        del session['experiment_id']
    if "experiment_template_id" in session:
        del session['experiment_template_id']
    if "experiment_title" in session:
        del session['experiment_title']
    if "participant_name" in session:
        del session['participant_name']

def is_safe_url(target):
    ref_url = urlparse(request.host_url)
    test_url = urlparse(urljoin(request.host_url, target))
    return test_url.scheme in ('http', 'https') and \
           ref_url.netloc == test_url.netloc

@login_manager.user_loader
def user_loader(email):
    return User.objects(email=email).first()


@login_manager.request_loader
def request_loader(request):
    print(">>request_loader: ",request)
    print(">>request_loader: ",request.form)
    email = request.form.get('email')
    user_query = User.objects(email=email, user_type__nin=["new"])
    print(">>request_loader|query mail: ", email)
    if user_query.count()==0:
        print(">>request_loader|not registered user: ", email)
        return

    user = user_query.first()

    # DO NOT ever store passwords in plaintext and always compare password
    # hashes using constant-time comparison!
    
    user.is_authenticated = check_password_hash(user.password, request.form['password'])

    return user

@bp.route('/signin', methods=['GET', 'POST'])
def signin():
    form = LoginForm()
    if request.method == 'GET':
        return render_template('auth/signin.html', form=form)
    next_url = quote(request.args.get('next', ''))
    signin_url = url_for('auth.signin', next=next_url)
    
    requested_user = User.objects(email=form.email.data).first()
    if requested_user is None:
        flash('Bad signin: ID or PW error', "danger")
        return redirect(signin_url)
    if not requested_user.email_verified:
        flash('Bad signin: Email not verified', "danger")
        send_verification_email(requested_user)
        return redirect(signin_url)

    requested_user.is_authenticated = check_password_hash (requested_user.password, form.password.data)
    if requested_user.is_authenticated:
        login_user(requested_user)
        next_page = request.args.get('next')  # Get the next URL parameter
        if not is_safe_url(next_page):
            return abort(400)  # Bad request

        return redirect(next_page or url_for('main.main_page'))

    flash('Bad signin: ID or PW error', "danger")
    return redirect(signin_url)

@bp.route('/register', methods=['GET', 'POST'])
def register():
    form = RegistrationForm()
    if form.validate_on_submit():
        if User.objects(email=request.form['email']).count():
            flash(f'이미 가입되어 있습니다: {form.email.data}', 'danger')
        else:
            new_user = User(email=form.email.data,
                            name=form.username.data,
                            phone=form.phone_number.data,
                            affiliation=form.affiliation.data,
                            password=generate_password_hash(form.password.data) )
            print("email: ",request.form['email'])
            new_user.save()

            send_verification_email(new_user)
            flash(f'{new_user.email} registered! (A confirmation email has been sent via email.)', 'success')

            return redirect(url_for('auth.signin'))
        
    return render_template('auth/register.html', form=form)

@bp.route('/confirm/<token>')
def confirm_email(token):
    try:
        serializer = URLSafeTimedSerializer(current_app.config['SECRET_KEY'])
        email = serializer.loads(
            token,
            salt=current_app.config['SECURITY_PASSWORD_SALT'],
            max_age=3600
        )
    except (SignatureExpired, BadSignature):
        # Handle the invalid or expired token
        flash('The confirmation link is invalid or has expired.', 'danger')
        return redirect(url_for('register'))

    user = User.objects(email=email).first()
    if user.email_verified:
        flash('Account already confirmed. Please login.', 'success')
    else:
        user.email_verified = True
        user.save()
        flash('You have confirmed your account. Thanks!', 'success')

    return redirect(url_for('auth.signin'))

@bp.route('/protected')
@login_required
def protected():
    return 'Logged in as: ' + current_user.email

@bp.route('/logout')
def logout():
    logout_user()
    # return 'Logged out'
    clear_session()
    return redirect(url_for('main.main_page'))

@login_manager.unauthorized_handler
def unauthorized_handler():
    # need to redirect to login page
    flash("로그인 후 사용할 수 있습니다.", "danger")
    return redirect(url_for('auth.signin'))

from functools import wraps

def requires_roles(*roles):
    def wrapper(f):
        @wraps(f)
        def wrapped(*args, **kwargs):
            check_all = [one for one in roles if one in current_user.user_type]
            if len(check_all)==0:
                flash("You don't have permission to access this page.")
                return redirect(url_for('main.main_page'))
            return f(*args, **kwargs)
        return wrapped
    return wrapper



def generate_confirmation_token(email):
    serializer = URLSafeTimedSerializer(current_app.config['SECRET_KEY'])
    return serializer.dumps(email, salt=current_app.config['SECURITY_PASSWORD_SALT'])

def send_email(to, subject, template):
    msg = Message(
        subject,
        recipients=[to],
        html=template,
        sender=current_app.config['MAIL_DEFAULT_SENDER']
    )
    mail.send(msg)


def send_verification_email(user):
    token = generate_confirmation_token(user.email)
    confirm_url = url_for('auth.confirm_email', token=token, _external=True)
    html = render_template('auth/activate.html', confirm_url=confirm_url)
    subject = "Please confirm your email"
    send_email(user.email, subject, html)



