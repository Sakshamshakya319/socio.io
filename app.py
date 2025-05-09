from flask import Flask, request, jsonify, render_template
import datetime
import glob
import json
import os
import logging
from text_analysis import detect_content, process_text
from image_content_filter import ImageContentFilter
from cryptography.fernet import Fernet
import sys

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# Initialize Flask app
app = Flask(__name__)

# Configuration
app.config['DEBUG'] = True
app.config['SECRET_KEY'] = 'socio-io-secret-key-2025'
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['LOG_FOLDER'] = 'logs'
app.config['ENCRYPTION_KEY_FILE'] = 'encryption_key.key'

# Ensure directories exist
for folder in [app.config['UPLOAD_FOLDER'], app.config['LOG_FOLDER']]:
    os.makedirs(folder, exist_ok=True)

# Load or generate encryption key
def load_encryption_key():
    key_file = app.config['ENCRYPTION_KEY_FILE']
    if os.path.exists(key_file):
        with open(key_file, 'rb') as f:
            key = f.read()
        print("Encryption key loaded from encryption_key.key")
    else:
        key = Fernet.generate_key()
        with open(key_file, 'wb') as f:
            f.write(key)
        print("New encryption key generated and saved")
    
    return key

# Initialize encryption
encryption_key = load_encryption_key()
cipher_suite = Fernet(encryption_key)

# Helper functions
def save_processing_log(text, processed_text, detection_results, encryption_log, action):
    """Save processing log to file"""
    timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = os.path.join(app.config['LOG_FOLDER'], f"processing_log_{timestamp}.json")
    
    log_data = {
        'timestamp': timestamp,
        'original': text,
        'processed': processed_text,
        'detection_results': detection_results,
        'encryption_log': encryption_log,
        'action': action
    }
    
    # Ensure directory exists
    os.makedirs(app.config['LOG_FOLDER'], exist_ok=True)
    
    with open(filename, 'w') as f:
        json.dump(log_data, f, indent=2)
        
    return filename

def save_encryption_log(original_text, encrypted_text):
    """Save encryption log to file"""
    timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = os.path.join(app.config['LOG_FOLDER'], f"encryption_log_{timestamp}.json")
    
    log_data = {
        'timestamp': timestamp,
        'original': original_text,
        'encrypted': encrypted_text
    }
    
    with open(filename, 'w') as f:
        json.dump(log_data, f, indent=2)
        
    return filename

def load_encryption_log(filename):
    """Load encryption log from file"""
    try:
        filepath = os.path.join(app.config['LOG_FOLDER'], os.path.basename(filename))
        if not os.path.exists(filepath):
            filepath = filename  # Try with the name as provided
            
        with open(filepath, 'r') as f:
            return json.load(f)
    except Exception as e:
        app.logger.error(f"Error loading encryption log: {str(e)}")
        return None

# Process text based on detection results
def process_text(text, detection_results, action):
    """Process text based on detection and action"""
    encryption_log = {}
    
    if action == "keep":
        return text, encryption_log
        
    elif action == "remove":
        # Replace with asterisks
        processed_text = '*' * len(text)
        return processed_text, encryption_log
        
    elif action == "encrypt":
        # Encrypt the text
        encrypted_bytes = cipher_suite.encrypt(text.encode('utf-8'))
        encrypted_text = encrypted_bytes.decode('utf-8')
        
        # Save encryption log
        encryption_log = {
            "original": text,
            "encrypted": encrypted_text
        }
        
        log_file = save_encryption_log(text, encrypted_text)
        encryption_log["log_file"] = log_file
        
        # Return placeholder text
        processed_text = "[Encrypted content]"
        return processed_text, encryption_log
        
    else:
        return text, encryption_log

# Basic routes
@app.route('/')
def index():
    """Main page"""
    return render_template('index.html')

@app.route('/history')
def history():
    """Content moderation history"""
    # Get all processing logs
    logs = []
    log_pattern = os.path.join(app.config['LOG_FOLDER'], "processing_log_*.json")
    
    for filename in sorted(glob.glob(log_pattern), reverse=True):
        try:
            with open(filename, 'r') as f:
                log = json.load(f)
                logs.append({
                    'timestamp': datetime.datetime.strptime(log['timestamp'], '%Y%m%d_%H%M%S').isoformat(),
                    'action': log['action'],
                    'detection_summary': log['detection_results']
                })
        except Exception as e:
            app.logger.error(f"Error loading log file {filename}: {str(e)}")
            
    return jsonify(logs)

# API routes
@app.route('/api/status', methods=['GET'])
def api_status():
    """API status endpoint"""
    return jsonify({
        'active': True, 
        'version': '1.0',
        'timestamp': datetime.datetime.now().isoformat()
    })

@app.route('/analyze_text', methods=['POST'])
def analyze_text():
    """Analyze text content from the frontend"""
    try:
        data = request.json
        if not data or 'text' not in data:
            return jsonify({'error': 'No text provided'}), 400
            
        text = data['text']
        url = data.get('url', 'Unknown URL')
        
        app.logger.info(f"Analyzing text from {url}: {text[:50]}...")
        
        # Detect content using our module
        detection_results = detect_content(text)
        
        # Determine action based on detection
        action = "keep"
        if detection_results.get("hate_speech", False):
            action = "remove"
        elif detection_results.get("profanity", False):
            action = "remove"
        elif any(detection_results.get("sensitive_info", {}).values()):
            action = "encrypt"
            
        app.logger.info(f"Action determined for text: {action}")
        
        # Process text based on detection results
        processed_text, encryption_log = process_text(text, detection_results, action)
        
        # Save processing log
        log_filename = save_processing_log(text, processed_text, detection_results, 
                                           encryption_log, action)
        
        # Prepare response with explanations
        reasons = []
        if detection_results.get("hate_speech", False):
            reasons.append("Hate speech detected")
        if detection_results.get("profanity", False):
            reasons.append("Profanity detected")
            
        # Add details about sensitive information
        for category, items in detection_results.get("sensitive_info", {}).items():
            if items:
                reasons.append(f"{category.replace('_', ' ').title()} detected")
        
        return jsonify({
            'original_text': text,
            'processed_text': processed_text,
            'action': action,
            'reasons': reasons,
            'log_file': log_filename
        })
        
    except Exception as e:
        app.logger.error(f"Error analyzing text: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/analyze_image', methods=['POST'])
def analyze_image():
    """Analyze image content from the frontend"""
    try:
        data = request.json
        if not data or 'image_url' not in data:
            return jsonify({'error': 'No image URL provided'}), 400
            
        image_url = data['image_url']
        page_url = data.get('url', 'Unknown URL')
        
        app.logger.info(f"Analyzing image from {page_url}: {image_url}")
        
        # Initialize the image content filter if not already done
        if not hasattr(app, 'image_filter'):
            try:
                app.image_filter = ImageContentFilter()
                app.logger.info("Image content filter initialized successfully")
            except Exception as e:
                app.logger.error(f"Error initializing image filter: {str(e)}")
                # Fallback to mock results if filter initialization fails
                results = {
                    "overall_safety": "questionable",
                    "content_flags": ["violence", "sensitive_content"],
                    "confidence": 0.85
                }
        
        # Use the image filter to analyze the image
        try:
            # Analyze the image using the image_url
            analysis_results = app.image_filter.analyze_image(image_url=image_url, show_results=False)
            
            # Extract relevant information from the analysis results
            results = {
                "overall_safety": analysis_results.get("overall_safety", "safe"),
                "content_flags": analysis_results.get("content_flags", []),
                "confidence": 0.9,  # Default confidence
                "suggested_action": analysis_results.get("suggested_action", "allow")
            }
            
            app.logger.info(f"Image analysis results: {results}")
            
        except Exception as e:
            app.logger.error(f"Error during image analysis: {str(e)}")
            # Fallback to mock results if analysis fails
            results = {
                "overall_safety": "questionable",
                "content_flags": ["processing_error"],
                "confidence": 0.5
            }
        
        # Determine action based on results
        action = "allow"
        if results.get("overall_safety") == "unsafe":
            action = "block"
        elif results.get("overall_safety") == "questionable":
            action = "blur"
        elif results.get("overall_safety") == "potentially_concerning":
            action = "blur"  # Also blur potentially concerning content
        
        app.logger.info(f"Action determined for image: {action}")
        
        # Prepare reasons
        reasons = []
        for flag in results.get("content_flags", []):
            reasons.append(f"{flag.replace('_', ' ').replace(':', ': ').title()} detected")
        
        # Save log
        timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
        log_filename = os.path.join(app.config['LOG_FOLDER'], f"image_log_{timestamp}.json")
        
        # Ensure directory exists
        os.makedirs(os.path.dirname(log_filename), exist_ok=True)
        
        with open(log_filename, 'w') as f:
            json.dump({
                'timestamp': timestamp,
                'image_url': image_url,
                'page_url': page_url,
                'action': action,
                'reasons': reasons,
                'analysis': results
            }, f, indent=2)
        
        return jsonify({
            'image_url': image_url,
            'action': action,
            'reasons': reasons,
            'analysis': results
        })
        
    except Exception as e:
        app.logger.error(f"Error analyzing image: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/encryption_files', methods=['GET'])
def get_encryption_files():
    """Get list of encryption files"""
    try:
        # Find all encryption log files
        files = []
        log_pattern = os.path.join(app.config['LOG_FOLDER'], "encryption_log_*.json")
        
        for filename in glob.glob(log_pattern):
            try:
                with open(filename, 'r') as f:
                    data = json.load(f)
                    
                files.append({
                    'filename': os.path.basename(filename),
                    'date': datetime.datetime.fromtimestamp(os.path.getmtime(filename)).strftime('%Y-%m-%d %H:%M:%S'),
                    'content_type': 'text' if 'text' in filename else 'unknown'
                })
            except Exception as e:
                app.logger.error(f"Error loading encryption file {filename}: {str(e)}")
        
        return jsonify(files)
        
    except Exception as e:
        app.logger.error(f"Error getting encryption files: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/recover_content', methods=['GET'])
def recover_content():
    """Recover encrypted content"""
    try:
        filename = request.args.get('filename')
        if not filename:
            return jsonify({'error': 'No filename provided'}), 400
            
        # Load encryption log
        encryption_log = load_encryption_log(filename)
        if not encryption_log:
            return jsonify({'error': 'Invalid encryption file or file not found'}), 400
            
        # Recover the content
        recovered_text = encryption_log.get('original', '')
        
        return jsonify({
            'recovered_text': recovered_text
        })
        
    except Exception as e:
        app.logger.error(f"Error recovering content: {str(e)}")
        return jsonify({'error': str(e)}), 500

# Additional debug endpoints
@app.route('/debug/info', methods=['GET'])
def debug_info():
    """Provide debug info about the system"""
    try:
        return jsonify({
            'python_version': sys.version,
            'app_version': '1.0',
            'timestamp': datetime.datetime.now().isoformat(),
            'log_files': len(glob.glob(os.path.join(app.config['LOG_FOLDER'], "*.json"))),
            'has_encryption_key': os.path.exists(app.config['ENCRYPTION_KEY_FILE']),
            'image_filter_loaded': hasattr(app, 'image_filter')
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/debug/test_detection', methods=['POST'])
def debug_test_detection():
    """Test text detection without saving logs"""
    try:
        data = request.json
        if not data or 'text' not in data:
            return jsonify({'error': 'No text provided'}), 400
            
        text = data['text']
        detection_results = detect_content(text)
        
        action = "keep"
        if detection_results.get("hate_speech", False):
            action = "remove"
        elif detection_results.get("profanity", False):
            action = "remove"
        elif any(detection_results.get("sensitive_info", {}).values()):
            action = "encrypt"
        
        return jsonify({
            'text': text,
            'detection_results': detection_results,
            'determined_action': action
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# Initialization and startup
if __name__ == '__main__':
    # Log startup info
    app.logger.info("Starting Socio.io Content Moderation Backend")
    
    # Initialize the image content filter
    try:
        app.image_filter = ImageContentFilter()
        app.logger.info("Image content filter initialized successfully")
    except Exception as e:
        app.logger.error(f"Error initializing image filter: {str(e)}")
        app.logger.warning("Image filtering will use fallback mock implementation")
    
    app.logger.info("Content filter initialized successfully")
    
    # Run the application
    app.run(debug=True, host='127.0.0.1', port=5000)